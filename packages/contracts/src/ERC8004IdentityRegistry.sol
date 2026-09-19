// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title ERC8004IdentityRegistry
 * @notice A faithful, minimal ERC-8004 Identity Registry for networks where the
 *         canonical deployment does not exist.
 *
 * ON MAINNET (chainId 143) THIS CONTRACT IS NOT USED. TrustAgent binds to the
 * canonical registry at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432.
 *
 * It exists because Monad testnet (10143) has no published ERC-8004 deployment
 * -- verified by reading the code at the mainnet addresses and finding none.
 * Rather than fake the dependency or skip it, this implements the same shape:
 * an ERC-721 whose tokenURI points at the agent's registration file (agent
 * card), so `ownerOf()` means exactly what it means on mainnet and
 * TrustAgentPolicyRegistry needs no conditional logic.
 *
 * Registration is permissionless, matching the standard: anyone may register an
 * agent they control. Only the token owner may later change its card.
 */
contract ERC8004IdentityRegistry is ERC721 {
    uint256 private _nextTokenId = 1;

    mapping(uint256 => string) private _agentCard;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string agentCardUri);
    event AgentCardUpdated(uint256 indexed tokenId, string agentCardUri);

    error NotTokenOwner(uint256 tokenId, address caller);

    constructor() ERC721("ERC-8004 Trustless Agents", "AGENT") {}

    /// @notice Register a new agent identity.
    /// @param to Owner of the identity.
    /// @param agentCardUri URI of the registration file describing the agent.
    function register(address to, string calldata agentCardUri) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _agentCard[tokenId] = agentCardUri;
        emit AgentRegistered(tokenId, to, agentCardUri);
    }

    /// @notice Update an agent card as capabilities change.
    function setAgentCard(uint256 tokenId, string calldata agentCardUri) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        _agentCard[tokenId] = agentCardUri;
        emit AgentCardUpdated(tokenId, agentCardUri);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId); // reverts for a nonexistent token
        return _agentCard[tokenId];
    }

    function totalRegistered() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
