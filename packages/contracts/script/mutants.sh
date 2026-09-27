#!/usr/bin/env bash
# Mutation check for ChancelaGate: remove one rule at a time and make sure the
# test suite notices. A mutant that survives is a rule nothing tests.
#
#   bash script/mutants.sh        (from packages/contracts)
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
SRC=src/ChancelaGate.sol
BACKUP=$(mktemp)
cp "$SRC" "$BACKUP"
trap 'cp "$BACKUP" "$SRC"; rm -f "$BACKUP"' EXIT

# name | exact line to find | what to put instead
MUTANTS=(
  "target not checked|if (grant.target != target) return Reason.WRONG_TARGET;|"
  "call hash not checked|if (grant.callHash != callHash) return Reason.CALL_MISMATCH;|"
  "expiry not checked|if (block.timestamp >= grant.expiresAt) return Reason.EXPIRED;|"
  "expiry off by one|block.timestamp >= grant.expiresAt|block.timestamp > grant.expiresAt"
  "replay not checked|if (_used[grant.decisionHash]) return Reason.ALREADY_USED;|"
  "suspension not checked|if (registry.isSuspended(id)) return Reason.AGENT_SUSPENDED;|"
  "policy not checked|if (livePolicy != grant.policyHash) return Reason.POLICY_CHANGED;|"
  "agent wallet not checked|if (wallet == address(0) \|\| wallet != agent) return Reason.NOT_THE_AGENT;|"
  "signer not checked|err != ECDSA.RecoverError.NoError \|\| signer != attestor|err != ECDSA.RecoverError.NoError"
  "grant not spent|_used[grant.decisionHash] = true;\n        emit GrantConsumed|emit GrantConsumed"
  "revoke not owner-only|revert NotAgentOwner(agentTokenId, msg.sender);|"
  "expiresAt not signed|grant.policyHash,\n                    grant.expiresAt|grant.policyHash,\n                    uint64(0)"
)

killed=0; survived=0
for m in "${MUTANTS[@]}"; do
  IFS='|' read -r name find repl <<<"$(printf '%s' "$m" | sed 's/\\|/\x01/g')"
  find=${find//$'\x01'/|}; repl=${repl//$'\x01'/|}
  cp "$BACKUP" "$SRC"
  FIND="$find" REPL="$repl" python3 - "$SRC" <<'PY' || { echo "  !! could not apply: $name"; exit 2; }
import os, sys
p = sys.argv[1]; s = open(p).read()
f = os.environ["FIND"].replace("\\n", "\n"); r = os.environ["REPL"].replace("\\n", "\n")
if f not in s: sys.exit(1)
open(p, "w").write(s.replace(f, r, 1))
PY
  if forge test --match-path 'test/*Gate*' >/dev/null 2>&1 && forge test --match-path 'test/invariant/Gate*' >/dev/null 2>&1; then
    echo "  SURVIVED  $name"; survived=$((survived + 1))
  else
    echo "  killed    $name"; killed=$((killed + 1))
  fi
done
cp "$BACKUP" "$SRC"
if forge test --match-path 'test/*Gate*' >/dev/null 2>&1; then echo "  control   unmutated source passes"; else echo "  !! control fails"; exit 2; fi
echo "$killed killed, $survived survived"
[ "$survived" -eq 0 ]
