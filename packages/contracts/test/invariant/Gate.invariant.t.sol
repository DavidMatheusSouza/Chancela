// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustAgentPolicyRegistry as Reg} from "../../src/TrustAgentPolicyRegistry.sol";
import {ChancelaGate as Gate} from "../../src/ChancelaGate.sol";
import {ChancelaDemoVenue as Venue} from "../../src/ChancelaDemoVenue.sol";
import {MockIdentityRegistry} from "../MockIdentityRegistry.sol";

/**
 * Stateful fuzzing of the gate against a reference model.
 *
 * A random sequence issues grants (some signed by the registered attestor, some
 * by a key that merely looks the part), spends them with the right or the wrong
 * amount from the agent or a stranger, and meanwhile has the owner suspend,
 * reactivate, re-anchor the policy, rotate the attestor and revoke single grants,
 * while time moves on. Before every order the model predicts, in plain code,
 * whether it should execute; then the venue is called for real. Any disagreement
 * is counted, and so is every order that executed without the model's blessing.
 */
contract GateHandler is Test {
    Reg public immutable reg;
    Gate public immutable gate;
    Venue public immutable venue;

    uint256 public constant TOKEN = 1;
    address public constant OWNER = address(0x1001);
    address public constant AGENT = address(0x1002);
    address public constant STRANGER = address(0x1003);
    uint256[3] public attestorKeys = [uint256(0xA1), 0xA2, 0xA3];

    // What the model believes about the registry right now.
    uint256 public liveAttestorKey;
    bytes32 public livePolicy;
    uint32 public policyVersion;
    bool public suspended;

    struct Issued {
        Gate.Grant grant;
        bytes signature;
        uint256 amount;
        uint256 signerKey;
    }

    Issued[] internal issued;
    mapping(bytes32 => bool) public modelUsed;
    mapping(bytes32 => uint256) public executions;

    uint256 public mismatches;
    string public lastMismatch;
    uint256 public executedWithoutBlessing;
    uint256 public ordersOk;
    uint256 public ordersRefused;

    constructor(Reg reg_, Gate gate_, Venue venue_, MockIdentityRegistry identity) {
        reg = reg_;
        gate = gate_;
        venue = venue_;
        identity.mint(TOKEN, OWNER);
        liveAttestorKey = attestorKeys[0];
        livePolicy = keccak256("policy-1");
        policyVersion = 1;
        vm.startPrank(OWNER);
        reg_.setAgentWallet(TOKEN, AGENT);
        reg_.setAttestor(TOKEN, vm.addr(liveAttestorKey));
        reg_.anchorPolicy(TOKEN, 1, livePolicy);
        vm.stopPrank();
    }

    /* -------------------------------------------------------- the attestor */

    /// Mostly the live attestor; sometimes a stale or never-registered key.
    function issue(uint256 amountSeed, uint256 signerSeed, uint256 ttlSeed) external {
        uint256 amount = bound(amountSeed, 1, 1_000_000);
        uint256 pick = signerSeed % 5;
        uint256 key = pick < 3 ? liveAttestorKey : attestorKeys[pick % 3];
        Gate.Grant memory g = Gate.Grant({
            agentTokenId: TOKEN,
            target: address(venue),
            callHash: venue.orderHash("MON/USDC", "BUY", amount),
            decisionHash: keccak256(abi.encode("decision", issued.length)),
            policyHash: livePolicy,
            expiresAt: uint64(block.timestamp + bound(ttlSeed, 1, 600))
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gate.grantDigest(g));
        issued.push(Issued(g, abi.encodePacked(r, s, v), amount, key));
    }

    /* ----------------------------------------------------------- the agent */

    function place(uint256 which, bool exactAmount, uint256 otherAmount, bool fromAgent) external {
        if (issued.length == 0) return;
        Issued storage it = issued[which % issued.length];
        uint256 amount = exactAmount ? it.amount : bound(otherAmount, 1, 1_000_000);
        address caller = fromAgent ? AGENT : STRANGER;

        bool shouldRun = amount == it.amount && block.timestamp < it.grant.expiresAt
            && !modelUsed[it.grant.decisionHash] && !suspended && it.grant.policyHash == livePolicy
            && caller == AGENT && it.signerKey == liveAttestorKey;

        uint256 before = venue.orderCount();
        vm.prank(caller);
        try venue.placeOrder("MON/USDC", "BUY", amount, it.grant, it.signature) {
            ordersOk++;
            executions[it.grant.decisionHash]++;
            if (!shouldRun) {
                executedWithoutBlessing++;
                _mismatch("executed, model refused");
            }
            modelUsed[it.grant.decisionHash] = true;
            if (venue.orderCount() != before + 1) _mismatch("order count did not move");
        } catch {
            ordersRefused++;
            if (shouldRun) _mismatch("refused, model allowed");
            if (venue.orderCount() != before) _mismatch("refused order was counted");
        }
    }

    /* ----------------------------------------------------------- the owner */

    function suspendOrResume() external {
        vm.prank(OWNER);
        if (suspended) reg.reactivateAgent(TOKEN);
        else reg.suspendAgent(TOKEN, "fuzz");
        suspended = !suspended;
    }

    function reanchor() external {
        policyVersion++;
        livePolicy = keccak256(abi.encode("policy", policyVersion));
        vm.prank(OWNER);
        reg.anchorPolicy(TOKEN, policyVersion, livePolicy);
    }

    function rotateAttestor(uint256 seed) external {
        liveAttestorKey = attestorKeys[seed % 3];
        vm.prank(OWNER);
        reg.setAttestor(TOKEN, vm.addr(liveAttestorKey));
    }

    function revoke(uint256 which) external {
        if (issued.length == 0) return;
        bytes32 d = issued[which % issued.length].grant.decisionHash;
        vm.prank(OWNER);
        try gate.revoke(TOKEN, d) {
            if (modelUsed[d]) _mismatch("revoked a spent grant");
            modelUsed[d] = true;
        } catch {
            if (!modelUsed[d]) _mismatch("could not revoke a live grant");
        }
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 300));
    }

    /* ------------------------------------------------------------- helpers */

    function issuedCount() external view returns (uint256) {
        return issued.length;
    }

    function decisionAt(uint256 i) external view returns (bytes32) {
        return issued[i].grant.decisionHash;
    }

    function _mismatch(string memory what) internal {
        mismatches++;
        lastMismatch = what;
    }
}

contract GateInvariantTest is Test {
    GateHandler handler;
    Gate gate;
    Venue venue;

    function setUp() public {
        vm.warp(1_800_000_000);
        MockIdentityRegistry identity = new MockIdentityRegistry();
        Reg reg = new Reg(address(identity));
        gate = new Gate(address(reg));
        venue = new Venue(gate);
        handler = new GateHandler(reg, gate, venue, identity);
        targetContract(address(handler));
    }

    /// The contract and the model agree on every single order and revocation.
    function invariant_gateMatchesModel() public view {
        assertEq(handler.mismatches(), 0, handler.lastMismatch());
    }

    /// Nothing executed that the model -- signer, amount, caller, policy,
    /// suspension, expiry, prior use -- would have refused.
    function invariant_nothingExecutesWithoutAGoodGrant() public view {
        assertEq(handler.executedWithoutBlessing(), 0);
    }

    /// One decision, at most one execution.
    function invariant_noDecisionExecutesTwice() public view {
        uint256 n = handler.issuedCount();
        for (uint256 i = 0; i < n; ++i) {
            assertLe(handler.executions(handler.decisionAt(i)), 1);
        }
    }

    /// Every order the venue counted was paid for by a consumed grant.
    function invariant_ordersEqualConsumedGrants() public view {
        assertEq(venue.orderCount(), handler.ordersOk());
    }

    /// Not vacuous: the handler's own paths reach both outcomes, so the
    /// invariants above are about orders that really ran and really bounced.
    function test_handlerReachesBothOutcomes() public {
        handler.issue(500, 0, 100);
        handler.place(0, true, 0, true); // right amount, from the agent
        handler.place(0, true, 0, true); // same grant again
        handler.issue(700, 0, 100);
        handler.place(1, false, 701, true); // wrong amount
        assertEq(handler.ordersOk(), 1);
        assertEq(handler.ordersRefused(), 2);
        assertEq(handler.mismatches(), 0, handler.lastMismatch());
    }
}
