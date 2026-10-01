// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustAgentPolicyRegistry as Reg} from "../src/TrustAgentPolicyRegistry.sol";
import {ChancelaGate as Gate} from "../src/ChancelaGate.sol";
import {ChancelaAccount as Vault} from "../src/ChancelaAccount.sol";
import {MockIdentityRegistry} from "./MockIdentityRegistry.sol";

/// A protocol that knows nothing about Chancela: it takes native MON and
/// credits the sender, like a wrapper or a DEX taking msg.value.
contract ThirdPartyPool {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdrawTo(address to, uint256 value) external {
        balanceOf[msg.sender] -= value;
        (bool ok,) = to.call{value: value}("");
        require(ok, "pool: send");
    }

    function fail() external pure {
        revert("pool: no");
    }
}

contract ChancelaAccountTest is Test {
    MockIdentityRegistry identity;
    Reg reg;
    Gate gate;
    Vault account;
    ThirdPartyPool pool;

    address owner = address(0xA11CE);
    address buyer = address(0xB0B);
    address agent = address(0xDEFEA7);
    address otherAgent = address(0x07E7);
    uint256 attestorKey = 0xA77E5;

    uint256 constant TOKEN = 1;
    uint256 constant OTHER = 2;
    bytes32 constant POLICY_V1 = keccak256("policy-v1");
    bytes32 constant DECISION = keccak256("decision-1");

    function setUp() public {
        vm.warp(1_800_000_000);
        identity = new MockIdentityRegistry();
        identity.mint(TOKEN, owner);
        identity.mint(OTHER, owner);
        reg = new Reg(address(identity));
        gate = new Gate(address(reg));
        account = new Vault(gate, TOKEN);
        pool = new ThirdPartyPool();

        vm.startPrank(owner);
        reg.setAgentWallet(TOKEN, agent);
        reg.setAttestor(TOKEN, vm.addr(attestorKey));
        reg.anchorPolicy(TOKEN, 1, POLICY_V1);
        reg.setAgentWallet(OTHER, otherAgent);
        reg.setAttestor(OTHER, vm.addr(attestorKey));
        reg.anchorPolicy(OTHER, 1, POLICY_V1);
        vm.stopPrank();

        vm.deal(address(account), 10 ether);
    }

    /* -------------------------------------------------------------- helpers */

    bytes constant DEPOSIT = abi.encodeWithSignature("deposit()");

    function _grant(uint256 token, address target, uint256 value, bytes memory data)
        internal
        view
        returns (Gate.Grant memory)
    {
        return Gate.Grant({
            agentTokenId: token,
            target: address(account),
            callHash: account.callHash(target, value, data),
            decisionHash: keccak256(abi.encode(DECISION, token, value)),
            policyHash: POLICY_V1,
            expiresAt: uint64(block.timestamp + 60)
        });
    }

    function _sign(Gate.Grant memory g, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gate.grantDigest(g));
        return abi.encodePacked(r, s, v);
    }

    function _refused(Gate.Reason reason) internal {
        vm.expectRevert(abi.encodeWithSelector(Gate.Refused.selector, reason));
    }

    /* ------------------------------------------------------------ happy path */

    function test_allowedCallReachesAProtocolThatKnowsNothingAboutChancela() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);

        vm.expectEmit(true, true, false, true, address(account));
        emit Vault.Executed(g.decisionHash, address(pool), 0.01 ether, bytes4(keccak256("deposit()")));
        vm.prank(agent);
        account.execute(address(pool), 0.01 ether, DEPOSIT, g, sig);

        assertEq(pool.balanceOf(address(account)), 0.01 ether);
        assertEq(address(account).balance, 10 ether - 0.01 ether);
        assertTrue(gate.isUsed(g.decisionHash));
    }

    /* ---------------------------------------------------- what is refused */

    function test_forgedGrantReverts() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 5 ether, DEPOSIT);
        bytes memory forged = _sign(g, 0xBADBAD);
        vm.prank(agent);
        _refused(Gate.Reason.BAD_SIGNATURE);
        account.execute(address(pool), 5 ether, DEPOSIT, g, forged);
    }

    function test_grantForASmallCallCannotPayForALargerOne() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(agent);
        _refused(Gate.Reason.CALL_MISMATCH);
        account.execute(address(pool), 5 ether, DEPOSIT, g, sig);
    }

    function test_grantIsBoundToTargetAndCalldata() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.startPrank(agent);
        _refused(Gate.Reason.CALL_MISMATCH);
        account.execute(address(0xD00D), 0.01 ether, DEPOSIT, g, sig);
        _refused(Gate.Reason.CALL_MISMATCH);
        account.execute(address(pool), 0.01 ether, abi.encodeWithSignature("deposit(uint256)", 1), g, sig);
        vm.stopPrank();
    }

    function test_onlyTheAgentsWalletCanExecute() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(buyer);
        _refused(Gate.Reason.NOT_THE_AGENT);
        account.execute(address(pool), 0.01 ether, DEPOSIT, g, sig);
    }

    function test_anotherAgentsValidGrantCannotSpendThisAccount() public {
        // A genuine grant, signed by the attestor, sent by that agent's own
        // wallet -- for a different agent. This account is not theirs.
        Gate.Grant memory g = _grant(OTHER, address(pool), 1 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(otherAgent);
        vm.expectRevert(abi.encodeWithSelector(Vault.NotThisAgent.selector, OTHER, TOKEN));
        account.execute(address(pool), 1 ether, DEPOSIT, g, sig);
    }

    function test_aGrantIsSpentOnce() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.startPrank(agent);
        account.execute(address(pool), 0.01 ether, DEPOSIT, g, sig);
        _refused(Gate.Reason.ALREADY_USED);
        account.execute(address(pool), 0.01 ether, DEPOSIT, g, sig);
        vm.stopPrank();
    }

    function test_suspendingTheAgentFreezesTheAccount() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(owner);
        reg.suspendAgent(TOKEN, "stop");
        vm.prank(agent);
        _refused(Gate.Reason.AGENT_SUSPENDED);
        account.execute(address(pool), 0.01 ether, DEPOSIT, g, sig);
    }

    function test_aNewPolicyVoidsOutstandingGrants() public {
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0.01 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(owner);
        reg.anchorPolicy(TOKEN, 2, keccak256("policy-v2"));
        vm.prank(agent);
        _refused(Gate.Reason.POLICY_CHANGED);
        account.execute(address(pool), 0.01 ether, DEPOSIT, g, sig);
    }

    function test_aFailedCallRevertsEverythingAndKeepsTheGrant() public {
        bytes memory failing = abi.encodeWithSignature("fail()");
        Gate.Grant memory g = _grant(TOKEN, address(pool), 0, failing);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(agent);
        vm.expectRevert();
        account.execute(address(pool), 0, failing, g, sig);
        assertFalse(gate.isUsed(g.decisionHash));
    }

    function test_theAccountsOwnFunctionsAreNotReachable() public {
        bytes memory steal = abi.encodeWithSignature("withdraw(address,uint256)", agent, 10 ether);
        Gate.Grant memory g = _grant(TOKEN, address(account), 0, steal);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(agent);
        vm.expectRevert(Vault.SelfCall.selector);
        account.execute(address(account), 0, steal, g, sig);
    }

    /* ------------------------------------------------- the owner's way out */

    function test_theIdentityOwnerWithdrawsWithoutAGrant() public {
        vm.prank(owner);
        account.withdraw(payable(owner), 4 ether);
        assertEq(owner.balance, 4 ether);
    }

    function test_theOwnerMovesWhatTheAgentBoughtWithoutAGrant() public {
        // The agent deposited into the pool; the owner pulls the position out.
        Gate.Grant memory g = _grant(TOKEN, address(pool), 1 ether, DEPOSIT);
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(agent);
        account.execute(address(pool), 1 ether, DEPOSIT, g, sig);

        bytes memory pull = abi.encodeWithSignature("withdrawTo(address,uint256)", owner, 1 ether);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Vault.NotIdentityOwner.selector, agent));
        account.ownerExecute(address(pool), 0, pull);

        vm.prank(owner);
        account.ownerExecute(address(pool), 0, pull);
        assertEq(owner.balance, 1 ether);
        assertEq(pool.balanceOf(address(account)), 0);
    }

    function test_withdrawingToNobodyIsRefused() public {
        vm.prank(owner);
        vm.expectRevert(Vault.ZeroAddress.selector);
        account.withdraw(payable(address(0)), 1 ether);
    }

    function test_theAgentCannotWithdraw() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Vault.NotIdentityOwner.selector, agent));
        account.withdraw(payable(agent), 1 ether);
    }

    function test_sellingTheIdentityHandsOverTheFunds() public {
        identity.mint(TOKEN, buyer);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Vault.NotIdentityOwner.selector, owner));
        account.withdraw(payable(owner), 1 ether);
        vm.prank(buyer);
        account.withdraw(payable(buyer), 1 ether);
        assertEq(buyer.balance, 1 ether);
    }

    /* ------------------------------------------------------------- vectors */

    /// Pinned in packages/shared/test too: the TypeScript attestor and this
    /// contract must hash a call identically.
    function test_callHashVector() public view {
        assertEq(
            account.callHash(address(0x1234), 0.01 ether, hex"d0e30db0"),
            keccak256(abi.encode(account.CALL_TYPEHASH(), address(0x1234), 0.01 ether, keccak256(hex"d0e30db0")))
        );
        assertEq(
            account.CALL_TYPEHASH(), keccak256("CALL(address target,uint256 value,bytes data)")
        );
        // The same literal is asserted in packages/shared/test/grant.test.ts.
        assertEq(
            account.callHash(address(0x1234), 0.01 ether, hex"d0e30db0"),
            0xfa3a282cf932cf30b843d548f9a8ba9b5be40fcaacbd0f42cf8afbb51c14a7ec
        );
    }

    receive() external payable {}
}
