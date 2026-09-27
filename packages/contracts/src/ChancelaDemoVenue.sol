// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChancelaGate} from "./ChancelaGate.sol";
import {ChancelaGuarded} from "./ChancelaGuarded.sol";

/// @title ChancelaDemoVenue
/// @notice A stand-in trading venue that takes orders only with a chancela.
///
/// It holds no funds and matches nothing: an accepted order is an event, which
/// is all the demo needs to show where the line is. What it does show is real --
/// the order that the policy refused, or that was altered after the policy
/// allowed it, reverts here, on Monad, with the reason.
contract ChancelaDemoVenue is ChancelaGuarded {
    /// @dev What the attestor hashes for PLACE_ORDER. Mirrored in
    ///      packages/shared/src/grant.ts; a test pins both to the same vector.
    bytes32 public constant ORDER_TYPEHASH =
        keccak256("PLACE_ORDER(string market,string side,uint256 amount)");

    uint256 public orderCount;

    event OrderPlaced(
        uint256 indexed id,
        address indexed agent,
        bytes32 indexed decisionHash,
        string market,
        string side,
        uint256 amount
    );

    constructor(ChancelaGate gate) ChancelaGuarded(gate) {}

    /// @param amount Notional in cents, as the policy counted it.
    function placeOrder(
        string calldata market,
        string calldata side,
        uint256 amount,
        ChancelaGate.Grant calldata grant,
        bytes calldata signature
    ) external returns (uint256 id) {
        _requireChancela(grant, signature, orderHash(market, side, amount));
        id = ++orderCount;
        emit OrderPlaced(id, msg.sender, grant.decisionHash, market, side, amount);
    }

    function orderHash(string calldata market, string calldata side, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(ORDER_TYPEHASH, keccak256(bytes(market)), keccak256(bytes(side)), amount)
        );
    }
}
