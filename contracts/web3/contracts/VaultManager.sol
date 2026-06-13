// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
//  ██╗   ██╗ █████╗ ██╗   ██╗██╗  ████████╗
//  ██║   ██║██╔══██╗██║   ██║██║  ╚══██╔══╝
//  ██║   ██║███████║██║   ██║██║     ██║
//  ╚██╗ ██╔╝██╔══██║██║   ██║██║     ██║
//   ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║
//
//  VaultManager — Aionis copy-trading core contract
//  Chain: Mantle Sepolia Testnet (5003)
//
//  ── KNOWN GAP: agent pipeline is non-functional on Mantle ──────────────────
//  checkLeaderActivity / onWatcherResponse / onStrategistResponse and
//  updatePrice / onPriceUpdate all call out to IAgentPlatform at
//  0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776 — a bespoke on-chain AI-agent
//  dispatch system (JSON API agent + LLM agent). No equivalent has
//  been verified on Mantle Sepolia. These functions will revert until a
//  Mantle-compatible agent/oracle network is confirmed and wired in (see
//  frontend/docs/mantle-dex-integration.md). Vault management functions
//  (createVault, deposit, withdraw, pause/resume/reopen, allowlist mgmt,
//  closePosition, getters) are unaffected and work normally.
// ─────────────────────────────────────────────────────────────────────────────

// ── External interfaces ───────────────────────────────────────────────────────

// Confirmed against a live failed callback trace + a vendored
// `IAgents.sol` reference (sdk-snippets.md §1). Two things our original
// guess got wrong:
//
//   1. `createRequest`'s `data` is NOT `abi.encode(url, jsonPath)` — it must be
//      a real encoded call to one of the agent's typed fetch functions
//      (`abi.encodeWithSelector(IJsonApiAgent.fetchString.selector, url, path)`).
//      A plain `abi.encode(string,string)` starts with a zero offset word, whose
//      first 4 bytes are `0x00000000` — the validators dispatch on that as a
//      selector and fail with "unknown function selector: no method with id:
//      0x00000000" (verified twice in the on-chain trace, failureCount=2).
//
//   2. The platform's callback ABI is NOT `(uint256, bytes)` — it is always
//      `(uint256 requestId, AgentValidatorResponse[] responses,
//        AgentResponseStatus status, AgentRequestInfo request)`. Decoding the
//      live failed-callback calldata against this shape produced clean,
//      sensible values (requestId, validator addresses, executionCost, etc.);
//      our `(uint256, bytes)` assumption decoded garbage and reverted.

enum AgentResponseStatus { None, Pending, Success, Failed, TimedOut }
enum AgentConsensusType  { Majority, Threshold }

struct AgentValidatorResponse {
    address              validator;
    bytes                result;
    AgentResponseStatus  status;
    uint256              receipt;
    uint256              timestamp;
    uint256              executionCost;
}

struct AgentRequestInfo {
    uint256                   id;
    address                   requester;
    address                   callbackAddress;
    bytes4                    callbackSelector;
    address[]                 subcommittee;
    AgentValidatorResponse[]  responses;
    uint256                   responseCount;
    uint256                   failureCount;
    uint256                   threshold;
    uint256                   createdAt;
    uint256                   deadline;
    AgentResponseStatus       status;
    AgentConsensusType        consensusType;
    uint256                   remainingBudget;
}

/**
 * @notice Agent Platform — dispatches work to the off-chain agent fleet.
 * @dev Deployed at 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776.
 */
interface IAgentPlatform {
    function createRequest(
        uint256      agentId,
        address      cbContract,
        bytes4       cbSelector,
        bytes        calldata data
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

/// @dev The JSON API agent dispatches on the 4-byte selector of `data` — it
///      must be encoded as a genuine call to one of these typed fetchers, and
///      its `selector` argument is a plain dot-notation field path (no `$.`).
interface IJsonApiAgent {
    function fetchString(string calldata url, string calldata selector) external returns (string memory);
    function fetchUint(string calldata url, string calldata selector, uint8 decimals) external returns (uint256);
}

interface ILLMAgent {
    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool   chainOfThought
    ) external returns (int256);
}

/**
 * @notice Minimal aUSD interface — ERC-20 + mint for P&L settlement.
 */
interface IaUSD {
    function mint(address to, uint256 amount)                              external;
    function transfer(address to, uint256 amount)                         external returns (bool);
    function transferFrom(address from, address to, uint256 amount)       external returns (bool);
    function balanceOf(address account)                                   external view returns (uint256);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  VaultManager
 * @author Aionis Team
 * @notice Core contract for Aionis copy-trading.
 *
 * @dev    Each user creates one vault per leader they want to follow.
 *         aUSD is locked inside the vault and never sent to a DEX.
 *         When the leader trades, a three-stage agent pipeline fires:
 *
 *         ┌─────────────────────────────────────────────────────────────────┐
 *         │  1. WATCHER  (JSON API Agent, id=1)                             │
 *         │     Fetches latest swap by the leader from the Aionis API.      │
 *         │                                                                 │
 *         │  2. STRATEGIST  (LLM Agent, id=2)                              │
 *         │     Evaluates trade + vault risk profile → copy score 0-100.   │
 *         │                                                                 │
 *         │  3. EXECUTOR  (on-chain, this contract)                        │
 *         │     Opens a virtual Position. No DEX swap. aUSD stays here.    │
 *         └─────────────────────────────────────────────────────────────────┘
 *
 *         A separate price-update pipeline keeps latestPrice[token] fresh
 *         so getUnrealizedPnL() is always meaningful.
 *
 *         P&L settlement on close:
 *           profit → aUSD minted into vault (VaultManager must be a minter)
 *           loss   → aUSD deducted from vault accounting
 */
contract VaultManager {

    // ── Constants ─────────────────────────────────────────────────────────────

    address public constant AGENT_PLATFORM =
        0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;

    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant LLM_AGENT_ID      = 12847293847561029384;

    uint256 public constant MAX_TRADE_AGE      = 5 minutes;
    uint256 public constant PIPELINE_TIMEOUT   = 10 minutes;
    uint8   public constant MIN_COPY_SCORE  = 10;
    uint256 public constant MIN_TRADE_AUSD  = 1e6;      // 1 aUSD minimum per trade

    uint16  public constant MIN_SLIPPAGE_BPS = 10;      // 0.10%
    uint16  public constant MAX_SLIPPAGE_BPS = 2000;    // 20.00%

    // ── Immutables ────────────────────────────────────────────────────────────

    address public immutable AUSD;
    address public           owner;
    string  public           API_BASE;
    string  public           PRICE_API_BASE;

    // ── Enums ─────────────────────────────────────────────────────────────────

    enum VaultStatus    { ACTIVE, PAUSED, CLOSED }
    enum PositionStatus { OPEN, CLOSED }

    // ── Structs ───────────────────────────────────────────────────────────────

    /// @dev Granular per-vault trade filters layered on top of riskLevel/maxPerTradePct.
    ///      USD fields share aUSD's 6-decimal precision and use 0 as an explicit
    ///      "no limit" sentinel so followers aren't forced to set every bound.
    struct VaultLimits {
        uint16  slippageBps;        // max allowed price drift between leader entry and ours, in bps (always > 0)
        uint256 minLeaderTradeUsd;  // ignore leader trades smaller than this (0 = no floor)
        uint256 maxLeaderTradeUsd;  // ignore leader trades larger than this (0 = no ceiling)
        uint256 minAllocUsd;        // floor on copy allocation per trade (0 = platform default only)
        uint256 maxAllocUsd;        // ceiling on copy allocation per trade (0 = no ceiling)
    }

    struct VaultConfig {
        address     follower;
        address     leader;
        uint256     ausdLocked;       // total aUSD deposited into vault
        uint256     ausdAllocated;    // aUSD currently locked in open positions
        uint8       riskLevel;        // 1-10
        uint8       maxPerTradePct;   // max % of vault per single trade (1-100)
        address[]   allowlist;        // token addresses this vault is allowed to copy
        VaultStatus status;
        VaultLimits limits;
    }

    struct Position {
        address         follower;
        address         leader;
        bytes32         vaultId;
        address         token;           // token being held virtually
        uint256         ausdAllocated;   // aUSD locked for this position
        uint256         entryPrice;      // price × 1e10 at open
        uint256         exitPrice;       // price × 1e10 at close (0 if open)
        int256          pnl;             // in aUSD base units (+ profit, − loss)
        PositionStatus  status;
        uint256         openedAt;
        uint256         closedAt;
    }

    /// @dev Minimal trade context carried from the watcher callback to the executor.
    struct PendingTrade {
        address tokenOut;
        uint256 tradePrice;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice vaultId(follower, leader) → vault config
    mapping(bytes32  => VaultConfig)  public vaults;

    /// @notice positionId → position
    mapping(bytes32  => Position)     public positions;

    /// @notice follower → all their vault IDs
    mapping(address  => bytes32[])    public followerVaults;

    /// @notice vaultId → all position IDs (open + closed)
    mapping(bytes32  => bytes32[])    public vaultPositions;

    /// @notice follower → address allowed to trigger the agent pipeline on their behalf
    mapping(address  => address)      public keeperOf;

    // ── Agent pipeline ────────────────────────────────────────────────────────

    /// @dev requestId → vaultId  (watcher and strategist callbacks share this)
    mapping(uint256  => bytes32)      public requestToVault;

    /// @dev vaultId → traded token + trade-time price, carried from watcher → executor
    mapping(bytes32  => PendingTrade) private pendingTrade;

    /// @dev Timestamp when pipeline started; 0 = idle. Auto-expires after PIPELINE_TIMEOUT.
    mapping(bytes32  => uint256)      public pipelineActiveAt;

    // ── Price state ───────────────────────────────────────────────────────────

    /// @notice token address → latest price × 1e10
    mapping(address  => uint256)      public latestPrice;

    /// @dev requestId → token address  (price callback lookup)
    mapping(uint256  => address)      private priceRequestToToken;

    /// @dev position counter for unique IDs
    uint256 private _positionNonce;

    // ── Events ────────────────────────────────────────────────────────────────

    event VaultCreated(
        address indexed follower,
        address indexed leader,
        bytes32 indexed vaultId,
        uint256 amount
    );
    event VaultDeposited(bytes32 indexed vaultId, uint256 amount);
    event VaultWithdrawn(bytes32 indexed vaultId, uint256 amount);
    event VaultPaused(bytes32 indexed vaultId);
    event VaultResumed(bytes32 indexed vaultId);
    event VaultClosed(bytes32 indexed vaultId);
    event VaultReopened(
        address indexed follower,
        address indexed leader,
        bytes32 indexed vaultId,
        uint256 amount
    );
    event KeeperSet(address indexed follower, address indexed keeper);

    event AllowlistAdded(bytes32 indexed vaultId, address[] tokens);
    event AllowlistRemoved(bytes32 indexed vaultId, address[] tokens);

    event WatcherRequested(uint256 indexed requestId, bytes32 indexed vaultId);
    event WatcherResponse(
        uint256 indexed requestId,
        bytes32 indexed vaultId,
        address tokenOut,
        uint256 usdValue,
        uint256 tradeTimestamp
    );
    event StrategistRequested(uint256 indexed requestId, bytes32 indexed vaultId);
    event StrategistResponse(
        uint256 indexed requestId,
        bytes32 indexed vaultId,
        uint8   score,
        bool    willExecute
    );
    event TradeSkipped(bytes32 indexed vaultId, string reason);
    event TradeCopied(
        bytes32 indexed vaultId,
        address indexed token,
        uint256 ausdAllocated,
        uint8   copyScore
    );

    event PositionOpened(
        bytes32 indexed positionId,
        bytes32 indexed vaultId,
        address         token,
        uint256         ausdAllocated,
        uint256         entryPrice
    );
    event PositionClosed(
        bytes32 indexed positionId,
        bytes32 indexed vaultId,
        int256          pnl,
        uint256         exitPrice
    );

    event PriceUpdated(address indexed token, uint256 price);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "VM: not owner");
        _;
    }

    modifier onlyAgentPlatform() {
        require(msg.sender == AGENT_PLATFORM, "VM: caller is not agent platform");
        _;
    }

    modifier onlyFollowerOrKeeper(address follower) {
        require(
            msg.sender == follower || msg.sender == keeperOf[follower],
            "VM: not authorized"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _ausd, string memory _apiBase, string memory _priceApiBase) {
        require(_ausd != address(0), "VM: zero aUSD address");
        AUSD           = _ausd;
        owner          = msg.sender;
        API_BASE       = _apiBase;
        PRICE_API_BASE = _priceApiBase;
    }

    function setApiBase(string calldata base) external onlyOwner {
        API_BASE = base;
    }

    function setPriceApiBase(string calldata base) external onlyOwner {
        PRICE_API_BASE = base;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "VM: zero address");
        owner = newOwner;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  VAULT ID
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deterministic vault ID: one vault per (follower, leader) pair.
    function vaultId(address follower, address leader) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(follower, leader));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  VAULT MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Shared validation for VaultLimits — used by createVault and reopenVault.
    function _validateLimits(VaultLimits calldata limits) internal pure {
        require(
            limits.slippageBps >= MIN_SLIPPAGE_BPS && limits.slippageBps <= MAX_SLIPPAGE_BPS,
            "VM: slippageBps 10-2000"
        );
        require(
            limits.minLeaderTradeUsd == 0 ||
            limits.maxLeaderTradeUsd == 0 ||
            limits.minLeaderTradeUsd <= limits.maxLeaderTradeUsd,
            "VM: leader trade range invalid"
        );
        require(
            limits.minAllocUsd == 0 ||
            limits.maxAllocUsd == 0 ||
            limits.minAllocUsd <= limits.maxAllocUsd,
            "VM: alloc range invalid"
        );
    }

    /**
     * @notice Create a new vault for a specific leader.
     * @param leader           Wallet to copy-trade.
     * @param amount           aUSD to lock (must be pre-approved).
     * @param riskLevel        1 (conservative) – 10 (aggressive). Passed to LLM.
     * @param maxPerTradePct   Max % of vault per single trade (1-100).
     * @param allowlist        Token addresses this vault is allowed to copy.
     *                         Must contain at least one token — empty = no trades.
     * @param limits           Granular trade filters (slippage tolerance is required;
     *                         leader-trade-size and allocation bounds use 0 = no limit).
     */
    function createVault(
        address            leader,
        uint256            amount,
        uint8              riskLevel,
        uint8              maxPerTradePct,
        address[] calldata allowlist,
        VaultLimits calldata limits
    ) external {
        require(leader != address(0) && leader != msg.sender, "VM: invalid leader");
        require(riskLevel >= 1 && riskLevel <= 10,            "VM: riskLevel 1-10");
        require(maxPerTradePct >= 1 && maxPerTradePct <= 100, "VM: maxPct 1-100");
        require(allowlist.length > 0,                         "VM: allowlist empty, no trades will copy");
        require(amount > 0,                                   "VM: zero deposit");
        _validateLimits(limits);

        bytes32 id = vaultId(msg.sender, leader);
        require(vaults[id].follower == address(0),            "VM: vault already exists");

        require(
            IaUSD(AUSD).transferFrom(msg.sender, address(this), amount),
            "VM: deposit failed"
        );

        vaults[id] = VaultConfig({
            follower:       msg.sender,
            leader:         leader,
            ausdLocked:     amount,
            ausdAllocated:  0,
            riskLevel:      riskLevel,
            maxPerTradePct: maxPerTradePct,
            allowlist:      allowlist,
            status:         VaultStatus.ACTIVE,
            limits:         limits
        });

        followerVaults[msg.sender].push(id);

        emit VaultCreated(msg.sender, leader, id, amount);
    }

    /**
     * @notice Delegate a keeper address to trigger copy trades on your behalf.
     *         Set to address(0) to revoke.
     */
    function setKeeper(address keeper) external {
        keeperOf[msg.sender] = keeper;
        emit KeeperSet(msg.sender, keeper);
    }

    /**
     * @notice Top up an existing vault.
     */
    function deposit(address leader, uint256 amount) external {
        bytes32 id = vaultId(msg.sender, leader);
        require(vaults[id].status != VaultStatus.CLOSED, "VM: vault closed");
        require(amount > 0, "VM: zero amount");

        require(
            IaUSD(AUSD).transferFrom(msg.sender, address(this), amount),
            "VM: deposit failed"
        );
        vaults[id].ausdLocked += amount;

        emit VaultDeposited(id, amount);
    }

    /**
     * @notice Withdraw all aUSD and close the vault.
     *         Requires no open positions — close them first.
     */
    function withdraw(address leader) external {
        bytes32 id = vaultId(msg.sender, leader);
        VaultConfig storage v = vaults[id];
        require(v.follower == msg.sender,   "VM: not your vault");
        require(v.status != VaultStatus.CLOSED, "VM: already closed");
        require(v.ausdAllocated == 0,       "VM: close open positions first");

        uint256 balance = v.ausdLocked;
        v.ausdLocked = 0;
        v.status     = VaultStatus.CLOSED;

        require(IaUSD(AUSD).transfer(msg.sender, balance), "VM: withdraw failed");

        emit VaultWithdrawn(id, balance);
        emit VaultClosed(id);
    }

    /**
     * @notice Reopen a previously withdrawn (CLOSED) vault for the same leader,
     *         with a fresh deposit and config. The vaultId is derived solely from
     *         (follower, leader), so a closed vault can never be re-created via
     *         createVault — this is the only way back for that pair.
     */
    function reopenVault(
        address            leader,
        uint256            amount,
        uint8              riskLevel,
        uint8              maxPerTradePct,
        address[] calldata allowlist,
        VaultLimits calldata limits
    ) external {
        require(riskLevel >= 1 && riskLevel <= 10,            "VM: riskLevel 1-10");
        require(maxPerTradePct >= 1 && maxPerTradePct <= 100, "VM: maxPct 1-100");
        require(allowlist.length > 0,                         "VM: allowlist empty, no trades will copy");
        require(amount > 0,                                   "VM: zero deposit");
        _validateLimits(limits);

        bytes32 id = vaultId(msg.sender, leader);
        VaultConfig storage v = vaults[id];
        require(v.follower == msg.sender,         "VM: not your vault");
        require(v.status == VaultStatus.CLOSED,   "VM: not closed");

        require(
            IaUSD(AUSD).transferFrom(msg.sender, address(this), amount),
            "VM: deposit failed"
        );

        v.ausdLocked     = amount;
        v.ausdAllocated  = 0;
        v.riskLevel      = riskLevel;
        v.maxPerTradePct = maxPerTradePct;
        v.allowlist      = allowlist;
        v.status         = VaultStatus.ACTIVE;
        v.limits         = limits;

        emit VaultReopened(msg.sender, leader, id, amount);
    }

    /**
     * @notice Pause copy-trading for a vault (follower only).
     *         In-flight pipeline completes but no new ones start.
     */
    function pauseVault(address leader) external {
        bytes32 id = vaultId(msg.sender, leader);
        require(vaults[id].follower == msg.sender,          "VM: not your vault");
        require(vaults[id].status == VaultStatus.ACTIVE,   "VM: not active");
        vaults[id].status = VaultStatus.PAUSED;
        emit VaultPaused(id);
    }

    /**
     * @notice Resume a paused vault (follower only).
     */
    function resumeVault(address leader) external {
        bytes32 id = vaultId(msg.sender, leader);
        require(vaults[id].follower == msg.sender,          "VM: not your vault");
        require(vaults[id].status == VaultStatus.PAUSED,   "VM: not paused");
        vaults[id].status = VaultStatus.ACTIVE;
        emit VaultResumed(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ALLOWLIST MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Add tokens to the vault allowlist in a single transaction.
     * @param tokens Array of token addresses to allow. Duplicates are skipped.
     */
    function addToAllowlist(address leader, address[] calldata tokens) external {
        require(tokens.length > 0, "VM: empty array");
        bytes32 id = vaultId(msg.sender, leader);
        require(vaults[id].follower == msg.sender, "VM: not your vault");

        VaultConfig storage v = vaults[id];
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "VM: zero token address");
            if (!_inAllowlist(v.allowlist, tokens[i])) {
                v.allowlist.push(tokens[i]);
            }
        }

        emit AllowlistAdded(id, tokens);
    }

    /**
     * @notice Remove tokens from the vault allowlist in a single transaction.
     *         Vault must retain at least one token — removing all would freeze the vault.
     */
    function removeFromAllowlist(address leader, address[] calldata tokens) external {
        require(tokens.length > 0, "VM: empty array");
        bytes32 id = vaultId(msg.sender, leader);
        require(vaults[id].follower == msg.sender, "VM: not your vault");

        VaultConfig storage v = vaults[id];
        for (uint256 i = 0; i < tokens.length; i++) {
            _removeFromArray(v.allowlist, tokens[i]);
        }
        require(v.allowlist.length > 0, "VM: cannot remove all tokens from allowlist");

        emit AllowlistRemoved(id, tokens);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  AGENT PIPELINE — STEP 1: KICK OFF (WATCHER)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Trigger the copy-trade pipeline for a follower.
     * @dev    Called by the follower themselves or their delegated keeper.
     *         The watcher service calls this automatically when the leader trades.
     *
     * @param follower  The follower whose vault to check.
     * @param leader    The leader whose latest trade to fetch.
     */
    function checkLeaderActivity(
        address follower,
        address leader
    ) external payable onlyFollowerOrKeeper(follower) {
        bytes32 id = vaultId(follower, leader);
        VaultConfig storage v = vaults[id];

        require(v.status == VaultStatus.ACTIVE,    "VM: vault not active");
        require(
            pipelineActiveAt[id] == 0 ||
            block.timestamp > pipelineActiveAt[id] + PIPELINE_TIMEOUT,
            "VM: pipeline already running"
        );
        require(_freeBalance(v) > MIN_TRADE_AUSD,  "VM: insufficient free balance");

        pipelineActiveAt[id] = block.timestamp;

        // Reserve enough for JSON API call + LLM call.
        // JSON API: opDeposit + 0.09 STT (0.03/validator × 3), LLM: opDeposit + 0.21 STT (0.07/validator × 3).
        uint256 opDeposit = IAgentPlatform(AGENT_PLATFORM).getRequestDeposit();
        uint256 jsonFee   = opDeposit + 0.09 ether;
        uint256 llmFee    = opDeposit + 0.21 ether;
        require(msg.value >= jsonFee + llmFee, "VM: insufficient deposit (need >= jsonFee+llmFee)");

        string memory url = string.concat(API_BASE, _toHexString(leader), "/latest-swap");

        // The API exposes the trade pre-packed as a single ABI-encoded hex blob
        // at `swap.encoded` (see route comment) — one `fetchString` round-trip
        // gets us the whole `(tokenIn, tokenOut, usdValue, tradePrice, timestamp)`
        // tuple instead of chaining five single-field fetches.
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector,
            url,
            "swap.encoded"
        );

        uint256 requestId = IAgentPlatform(AGENT_PLATFORM).createRequest{value: jsonFee}(
            JSON_API_AGENT_ID,
            address(this),
            this.onWatcherResponse.selector,
            payload
        );

        requestToVault[requestId] = id;

        emit WatcherRequested(requestId, id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  AGENT PIPELINE — STEP 2: WATCHER CALLBACK → DISPATCH STRATEGIST
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Called by the Agent Platform after the JSON API Agent
     *         fetches the leader's latest swap from the Aionis API.
     *
     * @dev    The platform's real callback ABI is always
     *         `(uint256 requestId, AgentValidatorResponse[] responses,
     *           AgentResponseStatus status, AgentRequestInfo request)` —
     *         NOT `(uint256, bytes)`. `responses[0].result` holds the return
     *         value of the `fetchString` call we dispatched: a hex string
     *         of `abi.encode(tokenIn, tokenOut, usdValue, tradePrice, timestamp)`.
     */
    function onWatcherResponse(
        uint256                          requestId,
        AgentValidatorResponse[] memory  responses,
        AgentResponseStatus              status,
        AgentRequestInfo memory          /* request */
    ) external onlyAgentPlatform {
        bytes32 id = requestToVault[requestId];
        require(id != bytes32(0), "VM: unknown watcher request");
        delete requestToVault[requestId];

        VaultConfig storage v = vaults[id];

        if (status != AgentResponseStatus.Success || responses.length == 0) {
            emit TradeSkipped(id, "watcher request failed");
            pipelineActiveAt[id] = 0;
            return;
        }

        string memory encodedHex = abi.decode(responses[0].result, (string));
        (
            ,
            address tokenOut,
            uint256 usdValue,
            uint256 tradePrice,
            uint256 tradeTimestamp
        ) = abi.decode(
            _hexStringToBytes(encodedHex),
            (address, address, uint256, uint256, uint256)
        );

        emit WatcherResponse(requestId, id, tokenOut, usdValue, tradeTimestamp);

        // ── Stale trade guard ─────────────────────────────────────────────────
        if (block.timestamp - tradeTimestamp > MAX_TRADE_AGE) {
            emit TradeSkipped(id, "stale trade");
            pipelineActiveAt[id] = 0;
            return;
        }

        // ── Only copy BUY trades (tokenOut = asset being acquired) ────────────
        address tradedToken = tokenOut;

        // ── Allowlist check ───────────────────────────────────────────────────
        if (!_inAllowlist(v.allowlist, tradedToken)) {
            emit TradeSkipped(id, "token not in allowlist");
            pipelineActiveAt[id] = 0;
            return;
        }

        // ── Leader trade-size filter (0 = no bound) ──────────────────────────
        if (v.limits.minLeaderTradeUsd > 0 && usdValue < v.limits.minLeaderTradeUsd) {
            emit TradeSkipped(id, "leader trade below minimum");
            pipelineActiveAt[id] = 0;
            return;
        }
        if (v.limits.maxLeaderTradeUsd > 0 && usdValue > v.limits.maxLeaderTradeUsd) {
            emit TradeSkipped(id, "leader trade above maximum");
            pipelineActiveAt[id] = 0;
            return;
        }

        // ── Free balance check ────────────────────────────────────────────────
        uint256 freeBalance = _freeBalance(v);
        if (freeBalance <= MIN_TRADE_AUSD) {
            emit TradeSkipped(id, "insufficient free balance");
            pipelineActiveAt[id] = 0;
            return;
        }

        // ── Store trade context for the executor ─────────────────────────────
        pendingTrade[id] = PendingTrade({ tokenOut: tradedToken, tradePrice: tradePrice });

        // ── Build LLM prompt and dispatch ────────────────────────────────────
        uint256 maxTrade = (v.ausdLocked * v.maxPerTradePct) / 100;
        if (maxTrade > freeBalance) maxTrade = freeBalance;

        string memory prompt = _buildPrompt(
            v.leader, tradedToken, usdValue, tradeTimestamp,
            v.riskLevel, v.ausdLocked, freeBalance, maxTrade,
            latestPrice[tradedToken]
        );

        // Use contract balance (pre-funded by checkLeaderActivity msg.value) for LLM fee
        uint256 llmOpDeposit = IAgentPlatform(AGENT_PLATFORM).getRequestDeposit();
        uint256 llmFee       = llmOpDeposit + 0.21 ether;

        bytes memory llmPayload = abi.encodeWithSelector(
            ILLMAgent.inferNumber.selector,
            prompt,
            "You are a precise risk-scoring engine for a copy-trading vault. Respond with only an integer copy-score from 0 to 100.",
            int256(0),
            int256(100),
            false
        );

        uint256 llmRequestId = IAgentPlatform(AGENT_PLATFORM).createRequest{value: llmFee}(
            LLM_AGENT_ID,
            address(this),
            this.onStrategistResponse.selector,
            llmPayload
        );

        requestToVault[llmRequestId] = id;

        emit StrategistRequested(llmRequestId, id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  AGENT PIPELINE — STEP 3: STRATEGIST CALLBACK → OPEN POSITION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Called by the Agent Platform after the LLM Strategist
     *         evaluates the trade.
     *
     * @dev    Real callback ABI: `(uint256, AgentValidatorResponse[],
     *         AgentResponseStatus, AgentRequestInfo)`. We dispatched via
     *         `ILLMAgent.inferNumber`, so `responses[0].result` decodes to
     *         an `int256` copy-score (clamped to 0-100 below).
     */
    function onStrategistResponse(
        uint256                          requestId,
        AgentValidatorResponse[] memory  responses,
        AgentResponseStatus              status,
        AgentRequestInfo memory          /* request */
    ) external onlyAgentPlatform {
        bytes32 id = requestToVault[requestId];
        require(id != bytes32(0), "VM: unknown strategist request");
        delete requestToVault[requestId];

        if (status != AgentResponseStatus.Success || responses.length == 0) {
            emit TradeSkipped(id, "strategist request failed");
            delete pendingTrade[id];
            pipelineActiveAt[id] = 0;
            return;
        }

        int256 rawScore = abi.decode(responses[0].result, (int256));
        uint8  score;
        if (rawScore <= 0)        score = 0;
        else if (rawScore >= 100) score = 100;
        else                      score = uint8(uint256(rawScore));

        bool willExecute = score >= MIN_COPY_SCORE;
        emit StrategistResponse(requestId, id, score, willExecute);

        if (!willExecute) {
            emit TradeSkipped(id, "score below threshold");
            delete pendingTrade[id];
            pipelineActiveAt[id] = 0;
            return;
        }

        _openPosition(id, score);

        delete pendingTrade[id];
        pipelineActiveAt[id] = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  POSITION — OPEN (INTERNAL)
    // ─────────────────────────────────────────────────────────────────────────

    function _openPosition(bytes32 id, uint8 score) internal {
        VaultConfig storage v = vaults[id];

        PendingTrade memory pt = pendingTrade[id];
        address tokenOut   = pt.tokenOut;
        uint256 tradePrice = pt.tradePrice;

        uint256 freeBalance = _freeBalance(v);
        uint256 maxTrade    = (v.ausdLocked * v.maxPerTradePct) / 100;
        if (maxTrade > freeBalance) maxTrade = freeBalance;

        uint256 ausdAmount = (maxTrade * score) / 100;

        // ── Allocation floor: per-vault minAllocUsd layered on the platform floor ──
        uint256 allocFloor = v.limits.minAllocUsd > MIN_TRADE_AUSD ? v.limits.minAllocUsd : MIN_TRADE_AUSD;
        if (ausdAmount < allocFloor) {
            emit TradeSkipped(id, "allocation below minimum");
            return;
        }
        if (ausdAmount > freeBalance) {
            ausdAmount = freeBalance;   // cap to free balance
        }
        // ── Allocation ceiling: optional per-vault hard cap (0 = no ceiling) ──────
        if (v.limits.maxAllocUsd > 0 && ausdAmount > v.limits.maxAllocUsd) {
            ausdAmount = v.limits.maxAllocUsd;
        }

        // Use on-chain latestPrice if available, fall back to trade-time price
        uint256 entryPrice = latestPrice[tokenOut] > 0
            ? latestPrice[tokenOut]
            : tradePrice;

        // ── Slippage guard: drift between leader's execution price and ours ──────
        if (tradePrice > 0) {
            uint256 priceDiff = entryPrice > tradePrice ? entryPrice - tradePrice : tradePrice - entryPrice;
            uint256 slippageBpsActual = (priceDiff * 10000) / tradePrice;
            if (slippageBpsActual > v.limits.slippageBps) {
                emit TradeSkipped(id, "slippage exceeded");
                return;
            }
        }

        bytes32 posId = keccak256(
            abi.encodePacked(id, block.timestamp, tokenOut, ++_positionNonce)
        );

        positions[posId] = Position({
            follower:      v.follower,
            leader:        v.leader,
            vaultId:       id,
            token:         tokenOut,
            ausdAllocated: ausdAmount,
            entryPrice:    entryPrice,
            exitPrice:     0,
            pnl:           0,
            status:        PositionStatus.OPEN,
            openedAt:      block.timestamp,
            closedAt:      0
        });

        vaultPositions[id].push(posId);
        v.ausdAllocated += ausdAmount;

        emit PositionOpened(posId, id, tokenOut, ausdAmount, entryPrice);
        emit TradeCopied(id, tokenOut, ausdAmount, score);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  POSITION — CLOSE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Close an open position and settle P&L.
     * @dev    Called by:
     *           - The follower manually (stop-loss / take-profit)
     *           - The keeper wallet when the leader sells
     *
     *         Profit → VaultManager mints aUSD into vault (must be a minter).
     *         Loss   → aUSD deducted from vault accounting.
     *
     * @param positionId  The position to close.
     */
    function closePosition(bytes32 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.status == PositionStatus.OPEN, "VM: position not open");

        address follower = pos.follower;
        require(
            msg.sender == follower || msg.sender == keeperOf[follower],
            "VM: not authorized"
        );

        bytes32 id = pos.vaultId;
        VaultConfig storage v = vaults[id];

        uint256 exitPrice = latestPrice[pos.token];
        require(exitPrice > 0, "VM: no price available, call updatePrice first");

        // Virtual P&L: proportional to price change
        uint256 exitValue = (pos.ausdAllocated * exitPrice) / pos.entryPrice;
        int256  pnl       = int256(exitValue) - int256(pos.ausdAllocated);

        if (exitValue > pos.ausdAllocated) {
            // Profit: mint extra aUSD into the vault
            uint256 profit = exitValue - pos.ausdAllocated;
            IaUSD(AUSD).mint(address(this), profit);
            v.ausdLocked += profit;
        } else if (exitValue < pos.ausdAllocated) {
            // Loss: reduce vault balance
            uint256 loss = pos.ausdAllocated - exitValue;
            v.ausdLocked -= loss;
        }

        v.ausdAllocated -= pos.ausdAllocated;

        pos.exitPrice = exitPrice;
        pos.pnl       = pnl;
        pos.status    = PositionStatus.CLOSED;
        pos.closedAt  = block.timestamp;

        emit PositionClosed(positionId, id, pnl, exitPrice);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  PRICE UPDATE PIPELINE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Dispatch a JSON API Agent request to update the on-chain price
     *         for a given token. Called by the keeper after every leader swap.
     *
     * @param token  Token contract address (e.g. WSOMI).
     */
    function updatePrice(address token) external payable {
        require(token != address(0), "VM: zero token");

        uint256 opDeposit = IAgentPlatform(AGENT_PLATFORM).getRequestDeposit();
        require(msg.value >= opDeposit + 0.09 ether, "VM: insufficient deposit for price update");

        string memory url = string.concat(PRICE_API_BASE, _toHexString(token));
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            url,
            "price",
            uint8(10)
        );

        uint256 requestId = IAgentPlatform(AGENT_PLATFORM).createRequest{value: msg.value}(
            JSON_API_AGENT_ID,
            address(this),
            this.onPriceUpdate.selector,
            payload
        );

        priceRequestToToken[requestId] = token;
    }

    /**
     * @notice Called by the Agent Platform with the latest price.
     * @dev    Real callback ABI: `(uint256, AgentValidatorResponse[],
     *         AgentResponseStatus, AgentRequestInfo)`. We dispatched via
     *         `IJsonApiAgent.fetchUint(..., decimals=10)`, so
     *         `responses[0].result` decodes to a `uint256` price × 1e10.
     */
    function onPriceUpdate(
        uint256                          requestId,
        AgentValidatorResponse[] memory  responses,
        AgentResponseStatus              status,
        AgentRequestInfo memory          /* request */
    ) external onlyAgentPlatform {
        address token = priceRequestToToken[requestId];
        require(token != address(0), "VM: unknown price request");
        delete priceRequestToToken[requestId];

        if (status != AgentResponseStatus.Success || responses.length == 0) {
            return;
        }

        uint256 price = abi.decode(responses[0].result, (uint256));
        require(price > 0, "VM: invalid price");

        latestPrice[token] = price;

        emit PriceUpdated(token, price);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  VIEW FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Get a vault's full config.
    function getVault(address follower, address leader)
        external view
        returns (VaultConfig memory)
    {
        return vaults[vaultId(follower, leader)];
    }

    /// @notice Get the allowlist for a vault.
    function getAllowlist(address follower, address leader)
        external view
        returns (address[] memory)
    {
        return vaults[vaultId(follower, leader)].allowlist;
    }

    /// @notice aUSD in the vault not currently locked in positions.
    function getFreeBalance(address follower, address leader)
        external view
        returns (uint256)
    {
        return _freeBalance(vaults[vaultId(follower, leader)]);
    }

    /// @notice Get all vault IDs for a follower.
    function getFollowerVaults(address follower)
        external view
        returns (bytes32[] memory)
    {
        return followerVaults[follower];
    }

    /// @notice Get all open position IDs for a vault.
    function getOpenPositions(address follower, address leader)
        external view
        returns (bytes32[] memory openIds)
    {
        bytes32 id = vaultId(follower, leader);
        bytes32[] storage all = vaultPositions[id];

        uint256 count;
        for (uint256 i = 0; i < all.length; i++) {
            if (positions[all[i]].status == PositionStatus.OPEN) count++;
        }

        openIds = new bytes32[](count);
        uint256 j;
        for (uint256 i = 0; i < all.length; i++) {
            if (positions[all[i]].status == PositionStatus.OPEN) {
                openIds[j++] = all[i];
            }
        }
    }

    /**
     * @notice Aggregate unrealized P&L across all open positions in a vault.
     *         Requires latestPrice to be populated for each token via updatePrice().
     */
    function getUnrealizedPnL(address follower, address leader)
        external view
        returns (int256 totalPnl)
    {
        bytes32 id = vaultId(follower, leader);
        bytes32[] storage posIds = vaultPositions[id];

        for (uint256 i = 0; i < posIds.length; i++) {
            Position storage pos = positions[posIds[i]];
            if (pos.status != PositionStatus.OPEN) continue;

            uint256 currentPrice = latestPrice[pos.token];
            if (currentPrice == 0 || pos.entryPrice == 0) continue;

            int256 unrealized = int256((pos.ausdAllocated * currentPrice) / pos.entryPrice)
                              - int256(pos.ausdAllocated);
            totalPnl += unrealized;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    function _buildPrompt(
        address leader,
        address tradedToken,
        uint256 usdValue,
        uint256 tradeTimestamp,
        uint8   riskLevel,
        uint256 ausdLocked,
        uint256 freeBalance,
        uint256 maxTrade,
        uint256 currentPrice
    ) internal view returns (string memory) {
        uint256 tradeAgeSec      = block.timestamp - tradeTimestamp;
        uint256 freePct          = ausdLocked  > 0 ? (freeBalance * 100) / ausdLocked  : 0;
        uint256 tradeVsVaultPct  = ausdLocked  > 0 ? (usdValue    * 100) / ausdLocked  : 0;
        uint256 tradeVsFreePct   = freeBalance > 0 ? (usdValue    * 100) / freeBalance : 0;
        uint256 allocAtFullScore = maxTrade / 1e6;
        uint256 allocAt50        = maxTrade / 2e6;
        uint256 usdValueWhole    = usdValue    / 1e6;
        uint256 freeWhole        = freeBalance / 1e6;
        uint256 lockedWhole      = ausdLocked  / 1e6;
        uint256 maxWhole         = maxTrade    / 1e6;
        uint256 priceWhole       = currentPrice / 1e10;

        string memory header = string.concat(
            "You are a risk management engine for Aionis, a copy-trading platform on Mantle.\n",
            "Evaluate the trade below and decide what percentage of the follower vault to allocate.\n\n",
            "OUTPUT: Respond with ONLY a single integer 0-100. No explanation. No text. Just the number.\n\n",
            "SCORING SCALE:\n",
            "  0        = skip this trade entirely\n",
            "  1-33     = low confidence  (small allocation)\n",
            "  34-66    = medium confidence  (moderate allocation)\n",
            "  67-99    = high confidence  (significant allocation)\n",
            "  100      = maximum confidence  (full max-per-trade allocation)\n\n",
            "ALLOCATION FORMULA:\n",
            "  allocation = (score / 100) x max_per_trade\n",
            "  At score=100 -> $", _uint2str(allocAtFullScore), " allocated\n",
            "  At score=50  -> $", _uint2str(allocAt50),        " allocated\n\n"
        );

        string memory tradeSection = string.concat(
            "--- TRADE ---\n",
            "Leader wallet:             ", _toHexString(leader),             "\n",
            "Token bought:              ", _toHexString(tradedToken),        "\n",
            "Trade USD value:           $", _uint2str(usdValueWhole),        "\n",
            "Trade age:                 ",  _uint2str(tradeAgeSec),          "s ago\n",
            "Current token price:       $", _uint2str(priceWhole),           " (x1e10 units)\n",
            "Trade size vs follower vault: ", _uint2str(tradeVsVaultPct),    "% of vault\n",
            "Trade size vs free balance:   ", _uint2str(tradeVsFreePct),     "% of free capital\n\n"
        );

        string memory vaultSection = string.concat(
            "--- FOLLOWER VAULT ---\n",
            "Vault total:      $", _uint2str(lockedWhole),                   "\n",
            "Free balance:     $", _uint2str(freeWhole),
                                   " (", _uint2str(freePct),                 "% of vault)\n",
            "Max per trade:    $", _uint2str(maxWhole),                      "\n",
            "Risk tolerance:   ",  _uint2str(riskLevel),                     "/10\n\n"
        );

        string memory rules = string.concat(
            "--- RULES (apply strictly in order) ---\n",
            "1. If free balance < $1 -> return 0.\n",
            "2. If trade age > 120s -> return 0 (stale signal).\n",
            "3. If trade USD value < $5 -> return 0 (noise trade, ignore).\n",
            "4. If free balance < $10 -> return 0 (vault nearly empty).\n\n",
            "RISK SCORE CEILING:\n",
            "  Risk 1-2  -> max score 20\n",
            "  Risk 3-4  -> max score 40\n",
            "  Risk 5-6  -> max score 65\n",
            "  Risk 7-8  -> max score 85\n",
            "  Risk 9-10 -> max score 100\n\n",
            "FREE BALANCE PENALTIES:\n",
            "  Free balance < 10% of vault         -> reduce score by 30%\n",
            "  Trade size > 50% of free balance    -> reduce score by 20% (large relative exposure)\n",
            "  Trade size > 100% of free balance   -> return 0 (cannot afford)\n\n",
            "SIGNAL STRENGTH (use trade size vs follower vault, NOT raw dollars):\n",
            "  Trade < 5% of follower vault        -> weak signal, lean conservative\n",
            "  Trade 5-20% of follower vault       -> moderate signal\n",
            "  Trade > 20% of follower vault       -> strong signal, leader is making a big move\n",
            "  Trade > 50% of follower vault       -> very strong signal\n\n",
            "FRESHNESS BONUS:\n",
            "  Trade age < 10s                     -> add up to 10 to final score\n",
            "  Trade age 10-30s                    -> no adjustment\n",
            "  Trade age 30-120s                   -> reduce score by 10\n\n",
            "IMPORTANT: Do NOT treat $1000 as inherently significant.\n",
            "  A $1000 trade is strong if the follower vault is $2000 (50%).\n",
            "  A $1000 trade is weak if the follower vault is $100000 (1%).\n",
            "  Always reason in percentages, not absolute dollar amounts.\n\n",
            "Respond with a single integer 0-100."
        );

        return string.concat(header, tradeSection, vaultSection, rules);
    }

    function _freeBalance(VaultConfig storage v) internal view returns (uint256) {
        if (v.ausdAllocated >= v.ausdLocked) return 0;
        return v.ausdLocked - v.ausdAllocated;
    }

    function _inAllowlist(address[] storage list, address token) internal view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == token) return true;
        }
        return false;
    }

    function _removeFromArray(address[] storage arr, address token) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == token) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
    }

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory b    = abi.encodePacked(addr);
        bytes memory hex_ = "0123456789abcdef";
        bytes memory str  = new bytes(42);
        str[0] = "0"; str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2]     = hex_[uint8(b[i]) >> 4];
            str[3 + i * 2]     = hex_[uint8(b[i]) & 0x0f];
        }
        return string(str);
    }

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v; uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (v != 0) { k--; bstr[k] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(bstr);
    }

    /// @dev Decodes a `0x`-prefixed hex string (as returned by `fetchString`)
    ///      into raw bytes, e.g. for re-decoding an ABI-encoded payload that
    ///      the API exposed as a JSON string field.
    function _hexStringToBytes(string memory s) internal pure returns (bytes memory r) {
        bytes memory b = bytes(s);
        uint256 start = (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) ? 2 : 0;
        require((b.length - start) % 2 == 0, "VM: bad hex length");

        uint256 n = (b.length - start) / 2;
        r = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            r[i] = bytes1(
                _hexNibble(b[start + 2 * i]) * 16 + _hexNibble(b[start + 2 * i + 1])
            );
        }
    }

    function _hexNibble(bytes1 c) internal pure returns (uint8) {
        uint8 ch = uint8(c);
        if (ch >= 48 && ch <= 57)  return ch - 48;        // '0'-'9'
        if (ch >= 97 && ch <= 102) return ch - 87;        // 'a'-'f'
        if (ch >= 65 && ch <= 70)  return ch - 55;        // 'A'-'F'
        revert("VM: bad hex char");
    }

    receive() external payable {}
}
