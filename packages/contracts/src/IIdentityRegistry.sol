// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal view of the ERC-8004 Identity Registry (an ERC-721).
/// @dev On Monad mainnet this is 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432.
///      TrustAgent does not re-implement agent identity; it binds to it.
interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}
