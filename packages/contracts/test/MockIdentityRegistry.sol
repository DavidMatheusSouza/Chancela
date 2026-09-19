// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stand-in for the ERC-8004 Identity Registry in tests.
contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;

    function mint(uint256 tokenId, address to) external {
        owners[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = owners[tokenId];
        require(o != address(0), "ERC721: invalid token ID");
        return o;
    }
}
