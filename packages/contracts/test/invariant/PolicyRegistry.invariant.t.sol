// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustAgentPolicyRegistry as Reg} from "../../src/TrustAgentPolicyRegistry.sol";
import {MockIdentityRegistry} from "../MockIdentityRegistry.sol";

/**
 * Stateful fuzzing against a reference model.
 *
 * The unit tests check one rule at a time from a clean state. This checks all of
 * them at once, from whatever state a random sequence of calls leaves behind:
 * NFTs changing hands, attestors and wallets swapped (sometimes onto each other),
 * policies re-anchored, agents suspended mid-stream, decisions replayed, batches
 * with duplicates inside them.
 *
 * Every call the handler makes is first predicted by a plain model of the rules
 * written out below -- would it succeed, and what would it change -- and then
 * made for real. Any disagreement, in either direction, is counted. The invariants
 * say that count is zero and that the contract's state is the model's state.
 *
 * Every actor is drawn from one small pool, so the same address regularly turns
 * up as owner, attestor, agent wallet and stranger. That is where the
 * interesting bugs would be.
 */
contract RegistryHandler is Test {
    Reg public immutable reg;
    MockIdentityRegistry public immutable identity;

    uint256 public constant TOKENS = 3;
    address[7] public pool;

    struct Model {
        address owner;
        address attestor;
        address wallet;
        bool suspended;
        uint32 version;
        bytes32 policyHash;
        uint64 count;
    }

    mapping(uint256 => Model) public model;
    mapping(bytes32 => bool) public modelRecorded;
    bytes32[] public recordedHashes;

    /// Calls whose outcome the model got wrong. Must stay zero.
    uint256 public mismatches;
    string public lastMismatch;

    /// Successful writes by someone the model says had no right to make them.
    uint256 public unauthorizedWrites;

    /// A decision recorded that cited a policy other than the live one.
    uint256 public staleDecisions;

    /// How much each kind of outcome was exercised; printed by `forge test -vv`.
    uint256 public recordsOk;
    uint256 public recordsRefused;
    uint256 public anchorsOk;

    constructor(Reg reg_, MockIdentityRegistry identity_) {
        reg = reg_;
        identity = identity_;
        for (uint256 i = 0; i < 6; ++i) {
            pool[i] = address(uint160(0x1000 + i));
        }
        pool[6] = address(0);
        // Start each agent configured, the way a real one is, so that sequences
        // spend their calls on recording and breaking things rather than on setup.
        for (uint256 t = 1; t <= TOKENS; ++t) {
            address owner = pool[t - 1];
            address attestor = pool[t + 2];
            bytes32 policy = keccak256(abi.encode("policy", t));
            identity.mint(t, owner);
            vm.startPrank(owner);
            reg_.setAttestor(t, attestor);
            reg_.anchorPolicy(t, 1, policy);
            vm.stopPrank();
            model[t] = Model({
                owner: owner,
                attestor: attestor,
                wallet: address(0),
                suspended: false,
                version: 1,
                policyHash: policy,
                count: 0
            });
        }
    }

    /* --------------------------------------------------------------- helpers */

    function _token(uint256 seed) internal pure returns (uint256) {
        return bound(seed, 1, TOKENS);
    }

    /// Any of the six live actors. Never address(0): nobody sends from it.
    function _caller(uint256 seed) internal view returns (address) {
        return pool[bound(seed, 0, 5)];
    }

    /// Half the time the token's real owner, otherwise anyone -- owner included, by chance.
    function _ownerish(uint256 seed, uint256 t) internal view returns (address) {
        return seed % 2 == 0 ? model[t].owner : _caller(seed / 2);
    }

    /// Any of the pool, including address(0), for values rather than senders.
    function _addr(uint256 seed) internal view returns (address) {
        return pool[bound(seed, 0, 6)];
    }

    /// A small hash space, so replays and collisions actually happen.
    function _hash(uint256 seed) internal pure returns (bytes32) {
        return keccak256(abi.encode("decision", bound(seed, 0, 31)));
    }

    function _check(bool predicted, bool happened, string memory what) internal {
        if (predicted != happened) {
            mismatches++;
            lastMismatch = string.concat(what, predicted ? ": model allowed, contract refused" : ": model refused, contract allowed");
        }
    }

    /* ---------------------------------------------------------------- owners */

    function transferToken(uint256 tokenSeed, uint256 toSeed) external {
        uint256 t = _token(tokenSeed);
        address to = _caller(toSeed);
        identity.mint(t, to);
        model[t].owner = to;
    }

    function setAttestor(uint256 callerSeed, uint256 tokenSeed, uint256 attSeed) external {
        uint256 t = _token(tokenSeed);
        address caller = _ownerish(callerSeed, t);
        address att = _addr(attSeed);
        Model storage m = model[t];

        bool predicted = caller == m.owner && att != address(0) && att != m.wallet;
        vm.prank(caller);
        try reg.setAttestor(t, att) {
            _check(predicted, true, "setAttestor");
            if (caller != m.owner) unauthorizedWrites++;
            m.attestor = att;
        } catch {
            _check(predicted, false, "setAttestor");
        }
    }

    function setAgentWallet(uint256 callerSeed, uint256 tokenSeed, uint256 walletSeed) external {
        uint256 t = _token(tokenSeed);
        address caller = _ownerish(callerSeed, t);
        address w = _addr(walletSeed);
        Model storage m = model[t];

        bool predicted = caller == m.owner && !(w != address(0) && w == m.attestor);
        vm.prank(caller);
        try reg.setAgentWallet(t, w) {
            _check(predicted, true, "setAgentWallet");
            if (caller != m.owner) unauthorizedWrites++;
            m.wallet = w;
        } catch {
            _check(predicted, false, "setAgentWallet");
        }
    }

    function anchorPolicy(uint256 callerSeed, uint256 tokenSeed, uint32 version, uint256 hashSeed)
        external
    {
        uint256 t = _token(tokenSeed);
        address caller = _ownerish(callerSeed, t);
        Model storage m = model[t];
        // Mostly near the current version, so both "too old" and "next" occur.
        version = uint32(bound(version, m.version > 2 ? m.version - 2 : 0, uint256(m.version) + 3));
        bytes32 h = hashSeed % 8 == 0 ? bytes32(0) : keccak256(abi.encode("policy", hashSeed));

        bool predicted = caller == m.owner && h != bytes32(0) && version > m.version;
        vm.prank(caller);
        try reg.anchorPolicy(t, version, h) {
            _check(predicted, true, "anchorPolicy");
            if (caller != m.owner) unauthorizedWrites++;
            m.version = version;
            m.policyHash = h;
            anchorsOk++;
        } catch {
            _check(predicted, false, "anchorPolicy");
        }
    }

    function suspend(uint256 callerSeed, uint256 tokenSeed) external {
        uint256 t = _token(tokenSeed);
        address caller = _ownerish(callerSeed, t);
        Model storage m = model[t];

        bool predicted = caller == m.owner && !m.suspended;
        vm.prank(caller);
        try reg.suspendAgent(t, "FUZZ") {
            _check(predicted, true, "suspendAgent");
            if (caller != m.owner) unauthorizedWrites++;
            m.suspended = true;
        } catch {
            _check(predicted, false, "suspendAgent");
        }
    }

    function reactivate(uint256 callerSeed, uint256 tokenSeed) external {
        uint256 t = _token(tokenSeed);
        address caller = _ownerish(callerSeed, t);
        Model storage m = model[t];

        bool predicted = caller == m.owner && m.suspended;
        vm.prank(caller);
        try reg.reactivateAgent(t) {
            _check(predicted, true, "reactivateAgent");
            if (caller != m.owner) unauthorizedWrites++;
            m.suspended = false;
        } catch {
            _check(predicted, false, "reactivateAgent");
        }
    }

    /* ------------------------------------------------------------- attestors */

    function _input(uint256 t, uint256 hashSeed, bool citeLive, uint256 policySeed)
        internal
        view
        returns (Reg.DecisionInput memory d)
    {
        d = Reg.DecisionInput({
            agentTokenId: t,
            decisionHash: _hash(hashSeed),
            intentHash: keccak256(abi.encode("intent", hashSeed)),
            action: bytes4(keccak256(abi.encode("action", hashSeed % 4))),
            decision: Reg.Decision(hashSeed % 3),
            risk: Reg.Risk(hashSeed % 4),
            policyHash: citeLive ? model[t].policyHash : keccak256(abi.encode("policy", policySeed))
        });
    }

    /// Would the model accept this one decision, given `seen` extra hashes already taken in this call?
    function _accepts(address caller, Reg.DecisionInput memory d, bytes32[] memory seen, uint256 nSeen)
        internal
        view
        returns (bool)
    {
        Model storage m = model[d.agentTokenId];
        if (m.attestor == address(0) || caller != m.attestor) return false;
        if (m.suspended) return false;
        if (modelRecorded[d.decisionHash]) return false;
        for (uint256 i = 0; i < nSeen; ++i) {
            if (seen[i] == d.decisionHash) return false;
        }
        if (m.version == 0) return false;
        return m.policyHash == d.policyHash;
    }

    function _apply(address caller, Reg.DecisionInput memory d) internal {
        Model storage m = model[d.agentTokenId];
        if (caller != m.attestor) unauthorizedWrites++;
        if (d.policyHash != m.policyHash) staleDecisions++;
        modelRecorded[d.decisionHash] = true;
        recordedHashes.push(d.decisionHash);
        m.count++;
    }

    /// Mostly from the attestor, citing the live policy -- otherwise nothing ever records.
    function recordDecision(
        uint256 callerSeed,
        uint256 tokenSeed,
        uint256 hashSeed,
        uint256 policySeed,
        bool fromAttestor,
        bool citeLive
    ) external {
        uint256 t = _token(tokenSeed);
        address caller = fromAttestor && model[t].attestor != address(0) ? model[t].attestor : _caller(callerSeed);
        Reg.DecisionInput memory d = _input(t, hashSeed, citeLive, policySeed);

        bool predicted = _accepts(caller, d, new bytes32[](0), 0);
        vm.prank(caller);
        try reg.recordDecision(d) {
            _check(predicted, true, "recordDecision");
            _apply(caller, d);
            recordsOk++;
        } catch {
            _check(predicted, false, "recordDecision");
            recordsRefused++;
        }
    }

    /// A batch is all or nothing, including when it repeats a hash inside itself.
    function recordBatch(uint256 tokenSeed, uint256 hashSeed, uint8 len, bool citeLive) external {
        uint256 t = _token(tokenSeed);
        address caller = model[t].attestor == address(0) ? pool[0] : model[t].attestor;
        len = uint8(bound(len, 0, 4));
        hashSeed = bound(hashSeed, 0, 1 << 32);

        Reg.DecisionInput[] memory items = new Reg.DecisionInput[](len);
        bytes32[] memory seen = new bytes32[](len);
        bool predicted = len > 0;
        for (uint256 i = 0; i < len; ++i) {
            // Seeds eleven apart over a space of 32: sometimes the batch repeats itself.
            items[i] = _input(t, hashSeed + i * 11, citeLive, hashSeed);
            if (predicted && !_accepts(caller, items[i], seen, i)) predicted = false;
            seen[i] = items[i].decisionHash;
        }

        vm.prank(caller);
        try reg.recordDecisionBatch(items) {
            _check(predicted, true, "recordDecisionBatch");
            for (uint256 i = 0; i < len; ++i) {
                _apply(caller, items[i]);
            }
            recordsOk += len;
        } catch {
            _check(predicted, false, "recordDecisionBatch");
            recordsRefused++;
        }
    }

    function recordedLength() external view returns (uint256) {
        return recordedHashes.length;
    }
}

contract PolicyRegistryInvariantTest is Test {
    Reg reg;
    MockIdentityRegistry identity;
    RegistryHandler handler;

    function setUp() public {
        identity = new MockIdentityRegistry();
        reg = new Reg(address(identity));
        handler = new RegistryHandler(reg, identity);
        targetContract(address(handler));
    }

    /// Every call the fuzzer made succeeded or failed exactly as the rules say.
    function invariant_contractBehavesLikeTheModel() public view {
        assertEq(handler.mismatches(), 0, handler.lastMismatch());
    }

    /// Nobody but the agent's owner changed its settings; nobody but its attestor recorded for it.
    function invariant_noWriteWithoutTheRightKey() public view {
        assertEq(handler.unauthorizedWrites(), 0);
    }

    /// No recorded decision names a policy that was not live when it was recorded.
    function invariant_everyDecisionCitesTheLivePolicy() public view {
        assertEq(handler.staleDecisions(), 0);
    }

    /// The contract's state is the model's state, field by field.
    function invariant_stateMatchesTheModel() public view {
        for (uint256 t = 1; t <= handler.TOKENS(); ++t) {
            (address owner, address attestor, address wallet, bool suspended, uint32 version, bytes32 policyHash, uint64 count) =
                handler.model(t);
            (bytes32 liveHash, uint32 liveVersion,) = reg.activePolicy(t);
            assertEq(identity.ownerOf(t), owner, "owner");
            assertEq(reg.attestorOf(t), attestor, "attestor");
            assertEq(reg.agentWalletOf(t), wallet, "wallet");
            assertEq(reg.isSuspended(t), suspended, "suspended");
            assertEq(liveVersion, version, "version");
            assertEq(liveHash, policyHash, "policy hash");
            assertEq(reg.decisionCount(t), count, "count");
        }
    }

    /// An agent can never be its own attestor, whatever order the two were set in.
    function invariant_attestorIsNeverTheAgentWallet() public view {
        for (uint256 t = 1; t <= handler.TOKENS(); ++t) {
            address a = reg.attestorOf(t);
            if (a != address(0)) assertTrue(a != reg.agentWalletOf(t));
        }
    }

    /// Nothing recorded is ever lost, and nothing is counted twice.
    function invariant_recordsAreAppendOnly() public view {
        uint256 n = handler.recordedLength();
        uint256 total;
        for (uint256 t = 1; t <= handler.TOKENS(); ++t) {
            total += reg.decisionCount(t);
        }
        assertEq(total, n, "sum of counts == decisions recorded");
        for (uint256 i = 0; i < n; ++i) {
            assertTrue(reg.isDecisionRecorded(handler.recordedHashes(i)));
        }
    }
}
