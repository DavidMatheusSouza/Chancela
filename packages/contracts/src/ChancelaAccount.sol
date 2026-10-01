// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChancelaGate} from "./ChancelaGate.sol";
import {ChancelaGuarded} from "./ChancelaGuarded.sol";

/// @title ChancelaAccount
/// @notice An agent's funds, held where only a chancela can move them -- in
///         front of any contract on Monad, without that contract changing.
///
/// `ChancelaGuarded` makes a venue refuse what the policy refused, but only a
/// venue that adopts it. This turns the gate around: the agent's money lives in
/// this account, and the account makes a call -- to any protocol, with any
/// value and calldata -- only if the gate consumes a grant for exactly that
/// call. A DEX, a lending market or a plain transfer needs no integration; the
/// agent simply has nothing to spend outside its policy.
///
/// Who can do what:
///   - the agent's registered wallet calls `execute`, with a grant; nobody else
///     can, because the gate checks the caller against the registry;
///   - the account belongs to exactly one agent (`agentTokenId`): a grant
///     issued to any other agent is refused here, even a valid one;
///   - the holder of the agent's ERC-8004 identity can `withdraw` MON, or make
///     any call with `ownerExecute` (moving a token the agent bought, say), at
///     any time and with no grant -- the owner is never locked out of their own
///     funds, and selling the identity hands that right over with it.
///
/// @dev The call hash covers target, value and the exact calldata, so a grant
///      for a 0.01 MON swap cannot pay for a 10 MON one, or for the same amount
///      sent somewhere else. Mirrored by `accountCallHash` in
///      packages/shared/src/grant.ts; a test pins both to one vector.
contract ChancelaAccount is ChancelaGuarded {
    bytes32 public constant CALL_TYPEHASH =
        keccak256("CALL(address target,uint256 value,bytes data)");

    /// The one agent whose grants this account honours.
    uint256 public immutable agentTokenId;

    event Executed(
        bytes32 indexed decisionHash, address indexed target, uint256 value, bytes4 selector
    );
    event Withdrawn(address indexed to, uint256 value);
    event OwnerExecuted(address indexed target, uint256 value, bytes4 selector);
    event Received(address indexed from, uint256 value);

    error NotThisAgent(uint256 grantedTo, uint256 accountAgent);
    error NotIdentityOwner(address caller);
    error CallFailed(bytes returnData);
    error SelfCall();
    error ZeroAddress();

    constructor(ChancelaGate gate, uint256 agentTokenId_) ChancelaGuarded(gate) {
        agentTokenId = agentTokenId_;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @notice Make one call the agent's policy allowed, and nothing else.
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        ChancelaGate.Grant calldata grant,
        bytes calldata signature
    ) external returns (bytes memory result) {
        if (grant.agentTokenId != agentTokenId) revert NotThisAgent(grant.agentTokenId, agentTokenId);
        // The account's own functions are not reachable through a grant.
        if (target == address(this)) revert SelfCall();
        _requireChancela(grant, signature, callHash(target, value, data));

        bool ok;
        // Sending value to a caller-chosen target is this function's purpose; the
        // grant above binds target, value and calldata, so only the call the
        // policy allowed gets here. Triaged in docs/AUDIT.md.
        // slither-disable-next-line arbitrary-send-eth
        (ok, result) = target.call{value: value}(data);
        if (!ok) revert CallFailed(result);
        emit Executed(grant.decisionHash, target, value, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
    }

    /// @notice The identity owner takes MON out. No grant: the owner's
    ///         authority comes from holding the agent's ERC-8004 token.
    function withdraw(address payable to, uint256 value) external {
        _onlyIdentityOwner();
        if (to == address(0)) revert ZeroAddress();
        (bool ok, bytes memory ret) = to.call{value: value}("");
        if (!ok) revert CallFailed(ret);
        emit Withdrawn(to, value);
    }

    /// @notice The identity owner makes any call from the account -- to move a
    ///         token out, unwind a position, or anything the agent could do.
    function ownerExecute(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        _onlyIdentityOwner();
        if (target == address(this)) revert SelfCall();
        bool ok;
        // The caller is the agent's owner, checked against the registry above.
        // slither-disable-next-line arbitrary-send-eth
        (ok, result) = target.call{value: value}(data);
        if (!ok) revert CallFailed(result);
        emit OwnerExecuted(target, value, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
    }

    function _onlyIdentityOwner() private view {
        address owner = chancelaGate.registry().identityRegistry().ownerOf(agentTokenId);
        if (msg.sender != owner) revert NotIdentityOwner(msg.sender);
    }

    /// @notice What the attestor signs as the grant's `callHash`.
    function callHash(address target, uint256 value, bytes calldata data)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(CALL_TYPEHASH, target, value, keccak256(data)));
    }
}
