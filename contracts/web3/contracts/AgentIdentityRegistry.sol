// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  AgentIdentityRegistry — ERC-8004 "Trustless Agents" Identity Registry
//
//  ERC-721 where each token = an on-chain AI agent identity. `agentId` is the
//  tokenId and `agentURI` is the tokenURI, which resolves to the agent's
//  registration file (capabilities, endpoints, contracts, trust models).
//  Implements the ERC-8004 core Identity Registry interface:
//    register() / register(uri) / register(uri, metadata[]) → agentId
//    setMetadata / getMetadata
//    events Registered, MetadataSet
//
//  This is the Mantle Sepolia deployment for the Aether copy-trading agent
//  (Mantle Turing Test hackathon, Phase I: ERC-8004 identity on testnet).
//  If the hackathon provides a canonical registry, point to that address instead.
// ─────────────────────────────────────────────────────────────────────────────
contract AgentIdentityRegistry is ERC721URIStorage, ReentrancyGuard {

    struct MetadataEntry {
        string key;
        bytes  value;
    }

    uint256 private _nextId = 1;

    /// @dev agentId => key => value
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    event Registered(uint256 indexed agentId, string tokenURI, address indexed owner);
    event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value);

    constructor() ERC721("ERC-8004 Trustless Agent", "AGENT") {}

    // ── Registration ───────────────────────────────────────────────────────────

    /// @notice Register an agent with an agentURI and an initial metadata set.
    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external nonReentrant returns (uint256 agentId)
    {
        agentId = _register(agentURI);
        for (uint256 i = 0; i < metadata.length; i++) {
            _metadata[agentId][metadata[i].key] = metadata[i].value;
            emit MetadataSet(agentId, metadata[i].key, metadata[i].key, metadata[i].value);
        }
    }

    /// @notice Register an agent with just an agentURI.
    function register(string calldata agentURI) external nonReentrant returns (uint256 agentId) {
        agentId = _register(agentURI);
    }

    /// @notice Register an agent with no URI (set it later via standard ERC-721 means).
    function register() external nonReentrant returns (uint256 agentId) {
        agentId = _register("");
    }

    function _register(string memory agentURI) internal returns (uint256 agentId) {
        agentId = _nextId++;
        _safeMint(msg.sender, agentId);
        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }
        emit Registered(agentId, agentURI, msg.sender);
    }

    // ── Metadata ───────────────────────────────────────────────────────────────

    /// @notice Set a metadata key/value on an agent (owner only).
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external {
        require(ownerOf(agentId) == msg.sender, "AIR: not agent owner");
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    /// @notice Read a metadata value for an agent.
    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory) {
        return _metadata[agentId][key];
    }

    /// @notice Total number of registered agents.
    function totalAgents() external view returns (uint256) {
        return _nextId - 1;
    }
}
