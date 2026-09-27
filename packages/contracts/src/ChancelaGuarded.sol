// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChancelaGate} from "./ChancelaGate.sol";

/// @title ChancelaGuarded
/// @notice Inherit this to make a function refuse any agent call its owner's
///         policy did not allow. One line inside the function:
///
///             _requireChancela(grant, signature, keccak256(abi.encode(...args)));
///
///         The call hash is computed here, from the arguments this contract
///         actually received -- so a grant for a $200 order cannot pay for a
///         $2,000 one, whatever the agent was told.
abstract contract ChancelaGuarded {
    ChancelaGate public immutable chancelaGate;

    constructor(ChancelaGate gate) {
        chancelaGate = gate;
    }

    /// @dev Reverts with `ChancelaGate.Refused(reason)` unless the grant is good
    ///      for exactly this call, from this caller, right now. Spends it.
    function _requireChancela(
        ChancelaGate.Grant calldata grant,
        bytes calldata signature,
        bytes32 callHash
    ) internal {
        chancelaGate.consume(grant, signature, msg.sender, callHash);
    }
}
