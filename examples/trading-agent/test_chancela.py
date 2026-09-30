"""
Offline tests for chancela.py. Run from this directory:

    pip install eth-account
    python -m unittest -v

vectors.json is produced by the TypeScript implementation and checked by the
SDK's own tests too, so a change on either side that alters a single byte fails
one of the two suites.
"""

import json
import os
import unittest

from eth_account import Account
from eth_account.messages import encode_defunct

from chancela import Chancela, ChancelaError, canonical_json, intent_hash

HERE = os.path.dirname(os.path.abspath(__file__))
V = json.load(open(os.path.join(HERE, "vectors.json"), encoding="utf-8"))
SIGNED = V["signed"]
IMPOSTOR = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"  # Anvil #2, published


def client(**kw):
    kw.setdefault("attestor", SIGNED["attestor"])
    return Chancela(base_url="http://127.0.0.1:9", now=lambda: SIGNED["now"], **kw)


def decision(**over):
    capsule = dict(SIGNED["capsule"], **over)
    signature = SIGNED["signature"]
    if over:
        signature = Account.sign_message(
            encode_defunct(text=canonical_json(capsule)),
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",  # Anvil #1, published
        ).signature.hex()
    return {"capsule": capsule, "signature": signature}


def verify(d, parameters=None, c=None, agent=None, action=None):
    return (c or client()).verify(
        d, agent or V["agentId"], action or V["action"], SIGNED["parameters"] if parameters is None else parameters
    )


class SameBytesAsTypeScript(unittest.TestCase):
    def test_canonical_json(self):
        for case in V["cases"]:
            self.assertEqual(canonical_json(case["parameters"]), case["canonical"])

    def test_intent_hash(self):
        for case in V["cases"]:
            self.assertEqual(intent_hash(V["agentId"], V["action"], case["parameters"]), case["intentHash"])

    def test_key_order_does_not_matter(self):
        p = V["cases"][1]["parameters"]
        self.assertEqual(canonical_json(dict(reversed(list(p.items())))), canonical_json(p))

    def test_floats_are_refused_not_guessed(self):
        with self.assertRaises(ValueError):
            canonical_json({"amount": 200.5})
        with self.assertRaises(ValueError):
            canonical_json({"amount": 2**53})


class Verify(unittest.TestCase):
    def test_a_signature_made_in_typescript_verifies(self):
        self.assertEqual(verify(decision()).code, "OK")

    def test_changed_order_is_intent_mismatch(self):
        swapped = dict(SIGNED["parameters"], amount=2_000_000)
        self.assertEqual(verify(decision(), swapped).code, "INTENT_MISMATCH")
        extra = dict(SIGNED["parameters"], venue="kuru")
        self.assertEqual(verify(decision(), extra).code, "INTENT_MISMATCH")

    def test_a_refusal_is_never_permission(self):
        self.assertEqual(verify(decision(decision="DENY", reasonCode="LIMIT_EXCEEDED")).code, "NOT_AUTHORIZED")
        self.assertEqual(verify(decision(decision="REQUIRE_APPROVAL")).code, "NOT_AUTHORIZED")

    def test_other_agent_or_action(self):
        self.assertEqual(verify(decision(), agent="TA-001").code, "WRONG_AGENT_OR_ACTION")
        self.assertEqual(verify(decision(), action="TRANSFER_FUNDS").code, "WRONG_AGENT_OR_ACTION")

    def test_expired(self):
        c = Chancela(attestor=SIGNED["attestor"], now=lambda: SIGNED["capsule"]["expiresAt"])
        self.assertEqual(verify(decision(), c=c).code, "EXPIRED")

    def test_edited_capsule_no_longer_matches_its_signature(self):
        d = decision()
        d["capsule"] = dict(d["capsule"], risk="LOW")
        self.assertEqual(verify(d).code, "WRONG_ATTESTOR")

    def test_signed_by_someone_else(self):
        d = decision()
        d["signature"] = Account.sign_message(
            encode_defunct(text=canonical_json(d["capsule"])), IMPOSTOR
        ).signature.hex()
        self.assertEqual(verify(d).code, "WRONG_ATTESTOR")

    def test_garbage(self):
        self.assertEqual(verify({"capsule": None, "signature": "0x"}).code, "MALFORMED")
        self.assertEqual(verify(dict(decision(), signature="0x1234")).code, "BAD_SIGNATURE")

    def test_no_attestor_known_fails_closed(self):
        c = Chancela(now=lambda: SIGNED["now"])
        self.assertEqual(verify(decision(), c=c).code, "WRONG_ATTESTOR")


class Guard(unittest.TestCase):
    def _guard(self, answer, parameters=None):
        c = client()
        c.authorize = lambda *a: answer
        ran = []
        try:
            c.guard(V["agentId"], V["action"], parameters or SIGNED["parameters"], lambda d: ran.append(d))
        except ChancelaError as err:
            return err.code, ran
        return "RAN", ran

    def test_runs_only_when_allowed_and_verified(self):
        self.assertEqual(self._guard(dict(decision(), decision="ALLOW")), ("RAN", [dict(decision(), decision="ALLOW")]))

    def test_denied_never_runs(self):
        d = dict(decision(decision="DENY"), decision="DENY", reasonText="over the limit", reasonCode="LIMIT_EXCEEDED")
        self.assertEqual(self._guard(d), ("DENIED", []))

    def test_unverified_never_runs(self):
        d = dict(decision(), decision="ALLOW")
        swapped = dict(SIGNED["parameters"], amount=2_000_000)
        self.assertEqual(self._guard(d, swapped), ("UNVERIFIED_INTENT_MISMATCH", []))

    def test_unreachable_never_runs(self):
        ran = []
        with self.assertRaises(ChancelaError) as ctx:
            client(timeout=0.5).guard(V["agentId"], V["action"], SIGNED["parameters"], lambda d: ran.append(d))
        self.assertEqual((ctx.exception.code, ran), ("UNREACHABLE", []))


if __name__ == "__main__":
    unittest.main()
