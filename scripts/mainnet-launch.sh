#!/usr/bin/env bash
# Chancela on Monad mainnet, from an empty chain to a real Uniswap swap.
#
#   1. policy registry bound to the official ERC-8004 registry   (Deploy.s.sol)
#   2. ChancelaGate + demo venue over it                          (DeployGate.s.sol)
#   3. TA-LIVE's identity, wallet, attestor and policy; gas for the attestor
#      and the agent                                              (mainnet-agent.ts)
#   4. TA-LIVE's ChancelaAccount, funded with 1 MON               (DeployAccount.s.sol)
#   5. Sourcify verification of everything deployed
#   6. through the account, on Uniswap V3: a 1-cent swap the policy allows,
#      the same grant at 10x, and a refused $25,000 order with a forged grant
#                                                                 (account-swap-demo.ts)
#
# Each step is skipped when deployments/143.json already records it, so a run
# that stops halfway can be started again. Needs DEPLOYER_PRIVATE_KEY (holding
# ~15 MON: Monad keeps a 10 MON reserve on any account that sends value),
# ATTESTATION_PRIVATE_KEY and LIVE_AGENT_PRIVATE_KEY in .env.
#
#   bash scripts/mainnet-launch.sh            (from the repo root)
#
# Rehearse on a fork first, no MON spent:
#   anvil --fork-url https://rpc.monad.xyz --port 8547 &
#   cast rpc anvil_setBalance <deployer> 0xD02AB486CEDC0000 --rpc-url http://127.0.0.1:8547
#   MONAD_MAINNET_RPC_URL=http://127.0.0.1:8547 SKIP_VERIFY=1 bash scripts/mainnet-launch.sh
#   (then delete packages/contracts/deployments/143*.json and broadcast/*/143)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
set -a; . ./.env; set +a
export PATH="$HOME/.foundry/bin:$PATH"
RPC=${MONAD_MAINNET_RPC_URL:-https://rpc.monad.xyz}
C="$ROOT/packages/contracts"
JSON="$C/deployments/143.json"

[ "$(cast chain-id --rpc-url "$RPC")" = 143 ] || { echo "not Monad mainnet"; exit 1; }
DEPLOYER=$(cast wallet address "$DEPLOYER_PRIVATE_KEY")
echo "deployer $DEPLOYER  $(cast balance "$DEPLOYER" --rpc-url "$RPC" -e) MON"

get() { python3 -c "import json,sys; d=json.load(open('$JSON')); print(d.get('$1',''))" 2>/dev/null || true; }
put() { python3 - "$JSON" "$1" "$2" <<'PY'
import json, os, sys
p, k, v = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(p)) if os.path.exists(p) else {}
d[k] = v
json.dump(d, open(p, "w"))
PY
}
last_address() {  # contract address N in a broadcast's latest run
  python3 -c "import json; print(json.load(open('$C/broadcast/$1/143/run-latest.json'))['transactions'][$2]['contractAddress'])"
}

# 1. Registry, on the official ERC-8004 identity registry (Deploy.s.sol picks it on chain 143).
if [ -z "$(get policyRegistry)" ]; then
  # .env names the testnet copy of the identity registry; on mainnet the script
  # must fall back to the official one, so that variable is dropped here.
  (cd "$C" && env -u ERC8004_IDENTITY_REGISTRY forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast >/dev/null)
  [ "$(get identityRegistry)" = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 ] || { echo "registry not bound to the official ERC-8004"; exit 1; }
fi
REGISTRY=$(get policyRegistry); echo "registry $REGISTRY"

# 2. Gate and demo venue.
if [ -z "$(get gate)" ]; then
  (cd "$C" && POLICY_REGISTRY_ADDRESS=$REGISTRY forge script script/DeployGate.s.sol --rpc-url "$RPC" --broadcast >/dev/null)
  put gate "$(last_address DeployGate.s.sol 0)"; put demoVenue "$(last_address DeployGate.s.sol 1)"
fi
GATE=$(get gate); echo "gate     $GATE"

# 3. The agent: identity, wallet, attestor, policy, gas.
./node_modules/.bin/tsx scripts/mainnet-agent.ts
TOKEN=$(get agentTokenId)

# 4. The agent's account, with 1 MON to trade.
if [ -z "$(get account)" ]; then
  (cd "$C" && GATE_ADDRESS=$GATE ACCOUNT_AGENT_ID=$TOKEN forge script script/DeployAccount.s.sol --rpc-url "$RPC" --broadcast >/dev/null)
  put account "$(last_address DeployAccount.s.sol 0)"
fi
ACCOUNT=$(get account); echo "account  $ACCOUNT"
if [ "$(cast balance "$ACCOUNT" --rpc-url "$RPC")" = 0 ]; then
  cast send "$ACCOUNT" --value 1ether --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
fi
echo "account  $(cast balance "$ACCOUNT" --rpc-url "$RPC" -e) MON"

# 5. Sourcify: the source here is the bytecode there.
IDENTITY=$(get identityRegistry)
verify() { [ -n "${SKIP_VERIFY:-}" ] && return 0; (cd "$C" && forge verify-contract "$1" "$2" --chain-id 143 --verifier sourcify ${3:+--constructor-args "$3"} >/dev/null 2>&1 || true); }
verify "$REGISTRY" src/TrustAgentPolicyRegistry.sol:TrustAgentPolicyRegistry "$(cast abi-encode 'c(address)' "$IDENTITY")"
verify "$GATE" src/ChancelaGate.sol:ChancelaGate "$(cast abi-encode 'c(address)' "$REGISTRY")"
verify "$(get demoVenue)" src/ChancelaDemoVenue.sol:ChancelaDemoVenue "$(cast abi-encode 'c(address)' "$GATE")"
verify "$ACCOUNT" src/ChancelaAccount.sol:ChancelaAccount "$(cast abi-encode 'c(address,uint256)' "$GATE" "$TOKEN")"
echo "sourcify submitted"

# 6. The proof, on Uniswap V3.
CHAIN=mainnet GATE_ADDRESS=$GATE ACCOUNT_ADDRESS=$ACCOUNT ACCOUNT_AGENT_ID=$TOKEN ORDER_CENTS=${ORDER_CENTS:-1} \
  ./node_modules/.bin/tsx scripts/account-swap-demo.ts | tee "$C/deployments/143-proof.txt"
cat "$JSON"; echo
