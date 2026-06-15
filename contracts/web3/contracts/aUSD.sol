// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
//   █████╗ ██╗   ██╗███████╗██████╗
//  ██╔══██╗██║   ██║██╔════╝██╔══██╗
//  ███████║██║   ██║███████╗██║  ██║
//  ██╔══██║██║   ██║╚════██║██║  ██║
//  ██║  ██║╚██████╔╝███████║██████╔╝
//
//  aUSD — Aether test stablecoin
//  Chain: Mantle Sepolia Testnet (5003)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  aUSD
 * @notice Test stablecoin for the Aether copy-trading platform.
 *         Pegged 1:1 to USD for accounting purposes.
 *         6 decimals — matches real USDC denomination.
 *
 * @dev    Two mint paths:
 *           1. faucet()  — anyone can claim 10,000 aUSD every 24 hours
 *           2. mint()    — owner or whitelisted minters (e.g. VaultManager)
 */
contract aUSD is ERC20 {

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant FAUCET_AMOUNT   = 10_000 * 10 ** 6;   // 10,000 aUSD
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    // ── State ─────────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Addresses whitelisted to call mint() — e.g. VaultManager
    mapping(address => bool) public minters;

    /// @notice Last faucet claim timestamp per address
    mapping(address => uint256) public lastFaucet;

    // ── Events ────────────────────────────────────────────────────────────────

    event FaucetClaimed(address indexed user, uint256 amount);
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "aUSD: not owner");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "aUSD: not minter");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() ERC20("Aether USD", "aUSD") {
        owner = msg.sender;
    }

    // ── Decimals override ─────────────────────────────────────────────────────

    /// @notice 6 decimals — matches USDC denomination
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ── Faucet ────────────────────────────────────────────────────────────────

    /**
     * @notice Claim 10,000 aUSD. Rate-limited to once every 24 hours per address.
     */
    function faucet() external {
        require(
            block.timestamp >= lastFaucet[msg.sender] + FAUCET_COOLDOWN,
            "aUSD: cooldown active"
        );
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Returns seconds remaining until the next faucet claim is available.
     *         Returns 0 if the address can claim right now.
     */
    function faucetCooldownRemaining(address user) external view returns (uint256) {
        uint256 nextClaim = lastFaucet[user] + FAUCET_COOLDOWN;
        if (block.timestamp >= nextClaim) return 0;
        return nextClaim - block.timestamp;
    }

    // ── Mint ──────────────────────────────────────────────────────────────────

    /**
     * @notice Mint aUSD to any address. Callable by owner or whitelisted minters.
     * @param to     Recipient address
     * @param amount Amount in aUSD base units (6 decimals)
     */
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    // ── Minter management ─────────────────────────────────────────────────────

    /// @notice Whitelist an address (e.g. VaultManager) to call mint()
    function addMinter(address minter) external onlyOwner {
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    /// @notice Remove minting rights
    function removeMinter(address minter) external onlyOwner {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    // ── Ownership ─────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "aUSD: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
