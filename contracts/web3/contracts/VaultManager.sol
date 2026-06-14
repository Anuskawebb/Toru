// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
//  ██╗   ██╗ █████╗ ██╗   ██╗██╗  ████████╗
//  ██║   ██║██╔══██╗██║   ██║██║  ╚══██╔══╝
//  ██║   ██║███████║██║   ██║██║     ██║
//  ╚██╗ ██╔╝██╔══██║██║   ██║██║     ██║
//   ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║
//
//  VaultManager — Aether copy-trading core contract
//  Chain: Mantle Sepolia Testnet (5003)
//
//  ── MANTLE-NATIVE PIPELINE (no Somnia Agent Platform) ──────────────────────
//  The leader-trade fetch + AI scoring that previously ran on Somnia's on-chain
//  Agent Platform (JSON API agent + LLM agent, paid in STT) now run OFF-CHAIN in
//  the watcher/keeper service, which then pushes the result on-chain in a single
//  trusted call:
//
//      executeCopyTrade(...)  — keeper passes the leader's swap (tokenOut,
//                               usdValue, tradePrice, timestamp) + the AI copy
//                               score (0-100). All risk guards + position logic
//                               run on-chain, exactly as before.
//      setPrice(token, price) — keeper/oracle pushes the latest token price used
//                               for entry, slippage and P&L.
//
//  Authorization: executeCopyTrade is callable by the follower, their delegated
//  keeper (keeperOf), or the global `oracle` (the platform keeper). setPrice is
//  callable by `oracle`/owner. The full event sequence (WatcherResponse →
//  StrategistResponse → TradeCopied/TradeSkipped) is preserved so the existing
//  frontend activity feed keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// ── External interfaces ───────────────────────────────────────────────────────

/**
 * @notice Minimal ERC-20 interface (+ mint, used only on aUSD) — covers aUSD and
 *         the swapped token. `approve` lets the vault authorise the DEX router.
 */
interface IaUSD {
    function mint(address to, uint256 amount)                              external;
    function transfer(address to, uint256 amount)                         external returns (bool);
    function transferFrom(address from, address to, uint256 amount)       external returns (bool);
    function approve(address spender, uint256 amount)                     external returns (bool);
    function balanceOf(address account)                                   external view returns (uint256);
}

/**
 * @notice DEX router interface — FusionX V2 (Uniswap-V2 style) on Mantle Sepolia.
 *         `dex` holds the FusionXRouter address; swappable for any V2-style router.
 */
interface IFusionXRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  VaultManager
 * @author Aether Team
 * @notice Core contract for Aether copy-trading.
 *
 * @dev    Each user creates one vault per leader they want to follow.
 *         aUSD is locked inside the vault. When the leader trades, the off-chain
 *         keeper evaluates the trade (AI score) and calls executeCopyTrade, which
 *         opens a virtual Position. P&L settles on close against latestPrice.
 *
 *         P&L settlement on close:
 *           profit → aUSD minted into vault (VaultManager must be a minter)
 *           loss   → aUSD deducted from vault accounting
 */
contract VaultManager {

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant MAX_TRADE_AGE   = 5 minutes;
    uint8   public constant MIN_COPY_SCORE  = 10;
    uint256 public constant MIN_TRADE_AUSD  = 1e6;      // 1 aUSD minimum per trade

    uint16  public constant MIN_SLIPPAGE_BPS = 10;      // 0.10%
    uint16  public constant MAX_SLIPPAGE_BPS = 2000;    // 20.00%

    // ── Immutables / roles ──────────────────────────────────────────────────────

    address public immutable AUSD;
    address public           owner;
    /// @notice Trusted price/score pusher — the off-chain platform keeper service.
    address public           oracle;
    /// @notice DEX router that copy trades swap through (real on-chain execution).
    address public           dex;

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
        address         token;           // token actually held (swapped into)
        uint256         ausdAllocated;   // aUSD spent on the opening swap
        uint256         tokenAmount;     // real token amount received from the DEX
        uint256         entryPrice;      // price × 1e10 snapshot at open (informational)
        uint256         exitPrice;       // price × 1e10 snapshot at close (informational)
        int256          pnl;             // realised P&L in aUSD base units (+/−)
        PositionStatus  status;
        uint256         openedAt;
        uint256         closedAt;
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

    /// @notice follower → address allowed to trigger copy trades on their behalf
    mapping(address  => address)      public keeperOf;

    // ── Price state ───────────────────────────────────────────────────────────

    /// @notice token address → latest price × 1e10
    mapping(address  => uint256)      public latestPrice;

    /// @dev position counter for unique IDs
    uint256 private _positionNonce;

    /// @dev synthetic request counter — pairs the WatcherResponse/StrategistResponse
    ///      events of a single executeCopyTrade run for the activity feed.
    uint256 private _requestNonce;

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
    event OracleSet(address indexed oracle);
    event DexSet(address indexed dex);

    event AllowlistAdded(bytes32 indexed vaultId, address[] tokens);
    event AllowlistRemoved(bytes32 indexed vaultId, address[] tokens);

    // Kept (with a synthetic requestId) for frontend activity-feed compatibility.
    event WatcherRequested(uint256 indexed requestId, bytes32 indexed vaultId);
    event WatcherResponse(
        uint256 indexed requestId,
        bytes32 indexed vaultId,
        address tokenOut,
        uint256 usdValue,
        uint256 tradeTimestamp
    );
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

    /// @dev Follower self-service, their delegated keeper, or the global oracle/keeper.
    modifier onlyAuthorizedFor(address follower) {
        require(
            msg.sender == follower ||
            msg.sender == keeperOf[follower] ||
            msg.sender == oracle,
            "VM: not authorized"
        );
        _;
    }

    /// @dev Trusted price pusher: the platform keeper (oracle) or owner.
    modifier onlyOracle() {
        require(msg.sender == oracle || msg.sender == owner, "VM: not oracle");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _ausd) {
        require(_ausd != address(0), "VM: zero aUSD address");
        AUSD  = _ausd;
        owner = msg.sender;
    }

    /// @notice Set the trusted oracle/keeper allowed to push prices and drive copy trades.
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleSet(_oracle);
    }

    /// @notice Set the DEX router that copy trades swap through.
    function setDex(address _dex) external onlyOwner {
        dex = _dex;
        emit DexSet(_dex);
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
     * @param riskLevel        1 (conservative) – 10 (aggressive). Passed to the scorer.
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
    //  COPY-TRADE EXECUTION (keeper-driven, Mantle-native)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Evaluate and (if it passes) copy a leader's trade into a follower vault.
     * @dev    Replaces the old Somnia agent pipeline. The off-chain keeper supplies
     *         the leader's swap details (fetched from the DEX) and the AI copy score
     *         (computed off-chain). All risk guards + position logic run on-chain,
     *         identical to the previous on-chain flow.
     *
     * @param follower        Vault owner.
     * @param leader          Leader being copied.
     * @param tokenOut        Token the leader acquired (the asset to copy into).
     * @param usdValue        Leader's trade size in USD, aUSD 6-decimal units (×1e6).
     * @param tradePrice      Leader's execution price × 1e10.
     * @param tradeTimestamp  Unix seconds of the leader's trade.
     * @param score           AI copy score 0-100 (off-chain strategist).
     */
    function executeCopyTrade(
        address follower,
        address leader,
        address tokenOut,
        uint256 usdValue,
        uint256 tradePrice,
        uint256 tradeTimestamp,
        uint8   score
    ) external onlyAuthorizedFor(follower) {
        bytes32 id = vaultId(follower, leader);
        VaultConfig storage v = vaults[id];

        require(v.status == VaultStatus.ACTIVE,   "VM: vault not active");

        uint256 reqId = ++_requestNonce;
        emit WatcherRequested(reqId, id);
        emit WatcherResponse(reqId, id, tokenOut, usdValue, tradeTimestamp);

        // ── Stale trade guard ─────────────────────────────────────────────────
        if (block.timestamp - tradeTimestamp > MAX_TRADE_AGE) {
            emit TradeSkipped(id, "stale trade");
            return;
        }

        // ── Allowlist check ───────────────────────────────────────────────────
        if (!_inAllowlist(v.allowlist, tokenOut)) {
            emit TradeSkipped(id, "token not in allowlist");
            return;
        }

        // ── Leader trade-size filter (0 = no bound) ──────────────────────────
        if (v.limits.minLeaderTradeUsd > 0 && usdValue < v.limits.minLeaderTradeUsd) {
            emit TradeSkipped(id, "leader trade below minimum");
            return;
        }
        if (v.limits.maxLeaderTradeUsd > 0 && usdValue > v.limits.maxLeaderTradeUsd) {
            emit TradeSkipped(id, "leader trade above maximum");
            return;
        }

        // ── Free balance check ────────────────────────────────────────────────
        if (_freeBalance(v) <= MIN_TRADE_AUSD) {
            emit TradeSkipped(id, "insufficient free balance");
            return;
        }

        // ── Strategist score → execute decision ──────────────────────────────
        if (score > 100) score = 100;
        bool willExecute = score >= MIN_COPY_SCORE;
        emit StrategistResponse(reqId, id, score, willExecute);

        if (!willExecute) {
            emit TradeSkipped(id, "score below threshold");
            return;
        }

        _openPosition(id, tokenOut, tradePrice, score);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  POSITION — OPEN (INTERNAL)
    // ─────────────────────────────────────────────────────────────────────────

    function _openPosition(bytes32 id, address tokenOut, uint256 tradePrice, uint8 score) internal {
        VaultConfig storage v = vaults[id];
        require(dex != address(0), "VM: dex not set");

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

        // ── REAL SWAP: aUSD → tokenOut through FusionX ──────────────────────────
        // minOut enforces the vault's slippage tolerance against the live pool quote.
        address[] memory path = new address[](2);
        path[0] = AUSD;
        path[1] = tokenOut;
        uint256 expectedOut = IFusionXRouter(dex).getAmountsOut(ausdAmount, path)[1];
        uint256 minOut      = (expectedOut * (10000 - v.limits.slippageBps)) / 10000;
        IaUSD(AUSD).approve(dex, ausdAmount);
        uint256 tokenAmount = IFusionXRouter(dex).swapExactTokensForTokens(
            ausdAmount, minOut, path, address(this), block.timestamp + 300
        )[1];

        // Informational price snapshot (real economics come from the swap amounts).
        uint256 entryPrice = latestPrice[tokenOut] > 0 ? latestPrice[tokenOut] : tradePrice;

        bytes32 posId = keccak256(
            abi.encodePacked(id, block.timestamp, tokenOut, ++_positionNonce)
        );

        positions[posId] = Position({
            follower:      v.follower,
            leader:        v.leader,
            vaultId:       id,
            token:         tokenOut,
            ausdAllocated: ausdAmount,
            tokenAmount:   tokenAmount,
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
     * @notice Close an open position by swapping the held token back to aUSD.
     * @dev    Called by the follower (stop-loss / take-profit), their keeper, or
     *         the oracle when the leader sells. P&L is REAL — the difference
     *         between the aUSD received from the closing swap and the aUSD spent
     *         opening it. No minting: profit comes from actual swap proceeds.
     *
     * @param positionId  The position to close.
     */
    function closePosition(bytes32 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.status == PositionStatus.OPEN, "VM: position not open");

        address follower = pos.follower;
        require(
            msg.sender == follower ||
            msg.sender == keeperOf[follower] ||
            msg.sender == oracle,
            "VM: not authorized"
        );
        require(dex != address(0), "VM: dex not set");

        bytes32 id = pos.vaultId;
        VaultConfig storage v = vaults[id];

        // ── REAL SWAP: token → aUSD through FusionX ──────────────────────────
        address[] memory path = new address[](2);
        path[0] = pos.token;
        path[1] = AUSD;
        uint256 expectedOut  = IFusionXRouter(dex).getAmountsOut(pos.tokenAmount, path)[1];
        uint256 minOut       = (expectedOut * (10000 - v.limits.slippageBps)) / 10000;
        IaUSD(pos.token).approve(dex, pos.tokenAmount);
        uint256 ausdReceived = IFusionXRouter(dex).swapExactTokensForTokens(
            pos.tokenAmount, minOut, path, address(this), block.timestamp + 300
        )[1];

        int256 pnl = int256(ausdReceived) - int256(pos.ausdAllocated);

        // Replace the committed aUSD with the actual swap proceeds (no minting).
        v.ausdLocked     = v.ausdLocked - pos.ausdAllocated + ausdReceived;
        v.ausdAllocated -= pos.ausdAllocated;

        pos.exitPrice = latestPrice[pos.token];
        pos.pnl       = pnl;
        pos.status    = PositionStatus.CLOSED;
        pos.closedAt  = block.timestamp;

        emit PositionClosed(positionId, id, pnl, pos.exitPrice);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  PRICE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Push the latest price for a token (× 1e10). Called by the keeper/oracle
     *         after every leader swap. Replaces the old on-chain agent price fetch.
     * @param token  Token contract address.
     * @param price  Price × 1e10.
     */
    function setPrice(address token, uint256 price) external onlyOracle {
        require(token != address(0), "VM: zero token");
        require(price > 0,           "VM: invalid price");
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
     * @notice Aggregate unrealized P&L across all open positions in a vault,
     *         valued at the live DEX quote (what the held tokens would fetch in
     *         aUSD right now) minus what was spent opening them.
     */
    function getUnrealizedPnL(address follower, address leader)
        external view
        returns (int256 totalPnl)
    {
        if (dex == address(0)) return 0;
        bytes32 id = vaultId(follower, leader);
        bytes32[] storage posIds = vaultPositions[id];

        for (uint256 i = 0; i < posIds.length; i++) {
            Position storage pos = positions[posIds[i]];
            if (pos.status != PositionStatus.OPEN || pos.tokenAmount == 0) continue;

            address[] memory path = new address[](2);
            path[0] = pos.token;
            path[1] = AUSD;
            uint256 currentValue = IFusionXRouter(dex).getAmountsOut(pos.tokenAmount, path)[1];
            totalPnl += int256(currentValue) - int256(pos.ausdAllocated);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

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
}
