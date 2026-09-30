"""
Chancela for a Python trading agent -- one file, one dependency (eth-account).

    pip install eth-account

Ask Chancela before an order goes out, then check the signed answer yourself:
signed by the attestor the agent's owner registered on Monad, bound to the exact
order you are about to send, and not expired. A deployment that lies can refuse
to answer; it cannot forge a yes that passes `verify`.

Fails closed throughout: no answer, a malformed answer and an answer that does
not verify all mean "do not send the order".

This is a port of `chancela-sdk` (TypeScript). The two must produce the same
bytes for the same order, or every verify fails -- `python demo.py` checks that
against the live deployment.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, NamedTuple, Optional, TypeVar

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_checksum_address

__all__ = ["Chancela", "ChancelaError", "Verdict", "canonical_json", "intent_hash"]

MONAD_TESTNET_RPC = "https://testnet-rpc.monad.xyz"
POLICY_REGISTRY = "0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e"

T = TypeVar("T")


class ChancelaError(Exception):
    """Raised by `guard` whenever the order must not be sent."""

    def __init__(self, code: str, message: str, decision: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.decision = decision


class Verdict(NamedTuple):
    ok: bool
    code: str  # OK | NOT_AUTHORIZED | MALFORMED | WRONG_AGENT_OR_ACTION | INTENT_MISMATCH | EXPIRED | BAD_SIGNATURE | WRONG_ATTESTOR
    detail: str = ""


# --- canonical JSON: byte-for-byte what packages/shared/src/canonical.ts emits ---


def _encode(value: Any, path: str) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        # JavaScript numbers are doubles; past 2^53 the SDK would hash a different number.
        if abs(value) > 2**53 - 1:
            raise ValueError(f"integer too large to hash like JavaScript (at {path or '<root>'}); send it as a string")
        return str(value)
    if isinstance(value, float):
        # Chancela's schemas never use floats: amounts are integer cents, size and
        # price are decimal strings. Refusing here beats a silent hash mismatch.
        raise ValueError(f"float at {path or '<root>'}: use integer cents or a decimal string")
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_encode(v, f"{path}[{i}]") for i, v in enumerate(value)) + "]"
    if isinstance(value, dict):
        # JavaScript sorts keys by UTF-16 code unit, which UTF-16-BE bytes reproduce.
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(
            f"{json.dumps(k, ensure_ascii=False)}:{_encode(value[k], f'{path}.{k}' if path else k)}" for k in keys
        ) + "}"
    raise ValueError(f"{type(value).__name__} is not canonicalisable (at {path or '<root>'})")


def canonical_json(value: Any) -> str:
    return _encode(value, "")


def intent_hash(agent_id: str, action: str, parameters: Dict[str, Any]) -> str:
    """keccak256 of the canonical intent -- what the capsule commits to."""
    body = canonical_json({"agentId": agent_id, "action": action, "parameters": parameters})
    return "0x" + keccak(body.encode("utf-8")).hex()


# --- client ---


class Chancela:
    """
    base_url:  a Chancela deployment, e.g. https://chancela.xyz -- yours or anyone's.
    attestor:  the signer you expect. Pin an address, or leave it None and pass
               `token_ids` to read it from the on-chain policy registry, where only
               the holder of the agent's ERC-8004 identity can set it.
    token_ids: agent id -> ERC-8004 token id, e.g. {"TA-LIVE": 4}.
    """

    def __init__(
        self,
        base_url: str = "https://chancela.xyz",
        attestor: Optional[str] = None,
        token_ids: Optional[Dict[str, int]] = None,
        rpc_url: str = MONAD_TESTNET_RPC,
        registry: str = POLICY_REGISTRY,
        timeout: float = 10.0,
        now: Callable[[], float] = time.time,
    ):
        self.base_url = base_url.rstrip("/")
        self.attestor = attestor
        self.token_ids = token_ids or {}
        self.rpc_url = rpc_url
        self.registry = registry
        self.timeout = timeout
        self.now = now
        self._attestors: Dict[str, str] = {}

    def _post(self, url: str, body: dict) -> dict:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json", "user-agent": "chancela-python/0.1"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as err:
            try:
                error = json.loads(err.read()).get("error", {})
            except Exception:
                error = {}
            raise ChancelaError(
                error.get("code", f"HTTP_{err.code}"),
                error.get("message", f"Chancela answered {err.code}. Nothing was authorized."),
            ) from None
        except Exception:
            # Unreachable is not permission.
            raise ChancelaError("UNREACHABLE", f"Could not reach {url}. Nothing was authorized.") from None

    def authorize(self, agent_id: str, action: str, parameters: Dict[str, Any]) -> dict:
        """Ask. Returns the decision whatever it is; a DENY is an answer, not an error."""
        decision = self._post(
            f"{self.base_url}/api/agents/{urllib.request.quote(agent_id, safe='')}/authorize",
            {"action": action, "parameters": parameters},
        )
        if not isinstance(decision, dict) or not decision.get("capsule") or not decision.get("signature"):
            raise ChancelaError("MALFORMED", "The answer carried no signed capsule. Nothing was authorized.")
        return decision

    def attestor_of(self, agent_id: str) -> str:
        """The attestor the agent's owner set on-chain: policyRegistry.attestorOf(tokenId)."""
        if self.attestor:
            return to_checksum_address(self.attestor)
        if agent_id in self._attestors:
            return self._attestors[agent_id]
        if agent_id not in self.token_ids:
            raise ChancelaError("NO_ATTESTOR", f"No attestor pinned and no ERC-8004 token id known for {agent_id}.")
        data = "0x" + keccak(b"attestorOf(uint256)")[:4].hex() + format(self.token_ids[agent_id], "064x")
        reply = self._post(
            self.rpc_url,
            {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": self.registry, "data": data}, "latest"]},
        )
        result = reply.get("result") or ""
        if len(result) != 66 or int(result, 16) == 0:
            raise ChancelaError("NO_ATTESTOR", f"No attestor is registered on-chain for {agent_id}.")
        address = to_checksum_address("0x" + result[-40:])
        self._attestors[agent_id] = address
        return address

    def verify(self, decision: dict, agent_id: str, action: str, parameters: Dict[str, Any]) -> Verdict:
        """
        Check a decision without trusting whoever sent it. Pass the parameters you
        are ABOUT TO SEND, not the ones you remember asking about.
        """
        capsule, signature = decision.get("capsule"), decision.get("signature")
        if not isinstance(capsule, dict) or not isinstance(signature, str):
            return Verdict(False, "MALFORMED")
        if capsule.get("decision") != "ALLOW":
            return Verdict(False, "NOT_AUTHORIZED", str(capsule.get("reasonCode")))
        if capsule.get("agentId") != agent_id or capsule.get("action") != action:
            return Verdict(False, "WRONG_AGENT_OR_ACTION", f"{capsule.get('agentId')} / {capsule.get('action')}")
        try:
            if intent_hash(agent_id, action, parameters) != capsule.get("intentHash"):
                return Verdict(False, "INTENT_MISMATCH")
        except ValueError as err:
            return Verdict(False, "INTENT_MISMATCH", str(err))
        expires_at = capsule.get("expiresAt")
        if not isinstance(expires_at, int) or expires_at <= self.now():
            return Verdict(False, "EXPIRED", f"expired at {expires_at}")
        try:
            signer = Account.recover_message(encode_defunct(text=canonical_json(capsule)), signature=signature)
        except Exception:
            return Verdict(False, "BAD_SIGNATURE")
        try:
            attestor = self.attestor_of(agent_id)
        except ChancelaError as err:
            return Verdict(False, "WRONG_ATTESTOR", str(err))
        if signer.lower() != attestor.lower():
            return Verdict(False, "WRONG_ATTESTOR", f"signed by {signer}, expected {attestor}")
        return Verdict(True, "OK")

    def guard(self, agent_id: str, action: str, parameters: Dict[str, Any], act: Callable[[dict], T]) -> T:
        """
        Run `act` only if the policy allows the action AND the permission verifies.
        Anything else raises ChancelaError, and `act` is never called.

            chancela.guard("TA-LIVE", "PLACE_ORDER", order, lambda d: exchange.place(**order))
        """
        decision = self.authorize(agent_id, action, parameters)
        if decision.get("decision") != "ALLOW":
            code = "DENIED" if decision.get("decision") == "DENY" else "APPROVAL_REQUIRED"
            raise ChancelaError(
                code,
                f"{action} was not authorized: {decision.get('reasonText')} ({decision.get('reasonCode')}). "
                f"Audit {decision.get('auditId')}.",
                decision,
            )
        verdict = self.verify(decision, agent_id, action, parameters)
        if not verdict.ok:
            raise ChancelaError(
                f"UNVERIFIED_{verdict.code}",
                f"The permission for {action} did not verify ({verdict.code}). Nothing was sent.",
                decision,
            )
        return act(decision)
