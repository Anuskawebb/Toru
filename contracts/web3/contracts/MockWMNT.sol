// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  MockWMNT — test volatile asset (stands in for WMNT) on Mantle Sepolia
//
//  18 decimals, openly mintable on testnet so we can seed the SimpleAMM pool.
//  This is the "token" a copy-trade position is actually swapped into.
// ─────────────────────────────────────────────────────────────────────────────
contract MockWMNT is ERC20 {
    address public owner;

    constructor() ERC20("Mock Wrapped MNT", "mWMNT") {
        owner = msg.sender;
    }

    /// @notice Open mint on testnet (anyone) — purely for seeding pools / demos.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
