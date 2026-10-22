#!/usr/bin/env bash
# Deploy LegalNotary on Base Sepolia and broadcast one CRE attestation.
#
# Default constructor arg is the Base Sepolia MockKeystoneForwarder. That is the
# contract `cre workflow simulate --broadcast` calls. The production
# KeystoneForwarder is a different address and will revert this path.
#
# Secrets stay in the environment or a gitignored .env. This script never prints
# CRE_ETH_PRIVATE_KEY or CRE_API_KEY. It does not write a tx hash unless forge
# or the CRE CLI actually returned a non-zero one and the receipt logged the notary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${HOME}/.cre/bin:${HOME}/.bun/bin:${PATH}"

CONFIG="cre/notary/config.staging.json"
CHAIN_NAME="ethereum-testnet-sepolia-base-1"
MIN_WEI="${NOTARY_MIN_WEI:-50000000000000}" # 0.00005 ETH
CHECK_ONLY=0
SKIP_BROADCAST=0

usage() {
  cat <<'EOF'
Usage: scripts/deploy-base-sepolia.sh [--check | --skip-broadcast]

  --check           Verify chain id, forwarder bytecode, and the contract build.
                    Does not deploy and does not need a key. Exit 0 when that
                    public path is healthy. Prints which secrets are still missing.
  --skip-broadcast  Deploy (or reuse) LegalNotary and write config.staging.json,
                    then stop before `cre workflow simulate --broadcast`.

Env (see .env.example; put them in repo-root .env, which is gitignored):
  CRE_ETH_PRIVATE_KEY   Funded Base Sepolia EOA. Required to deploy and broadcast.
  CRE_API_KEY           Or run `cre login` first. Required for simulate --broadcast.
  BASE_SEPOLIA_RPC_URL  Deploy/receipt RPC. Default https://sepolia.base.org.
                        Broadcast still uses the URL in cre/project.yaml.
  FORWARDER             Optional constructor override.
  FORWARDER_KIND        mock (default) or production. Production refuses broadcast.
  FRESH_DEPLOY=1        Deploy a new contract even if config.staging.json is set.
  NOTARY_PAYLOAD        HTTP payload file. Default samples/saas-de.json.
  CRE_TARGET            Default local-simulation.
EOF
}

load_dotenv() {
  local file="$1" line key val
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[2]}"
      val="${BASH_REMATCH[3]}"
      val="${val#"${val%%[![:space:]]*}"}"
      val="${val%"${val##*[![:space:]]}"}"
      if [[ "$val" == \"*\" && "$val" == *\" ]]; then val="${val:1}"; val="${val%\"}"; fi
      if [[ "$val" == \'*\' && "$val" == *\' ]]; then val="${val:1}"; val="${val%\'}"; fi
      if [[ -z "${!key:-}" ]]; then export "${key}=${val}"; fi
    fi
  done < "$file"
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --skip-broadcast) SKIP_BROADCAST=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

load_dotenv "$ROOT/.env"
[[ "${SKIP_BROADCAST_ENV:-}" == "1" ]] && SKIP_BROADCAST=1

PINS="$(python3 scripts/notary_config.py show-forwarders)"
MOCK_FORWARDER="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["mockKeystoneForwarder"])' "$PINS")"
PROD_FORWARDER="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["keystoneForwarder"])' "$PINS")"
RPC="${BASE_SEPOLIA_RPC_URL:-${RPC_URL:-https://sepolia.base.org}}"
PAYLOAD="${NOTARY_PAYLOAD:-$ROOT/samples/saas-de.json}"
TARGET="${CRE_TARGET:-local-simulation}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing $1 on PATH" >&2; exit 1; }
}
need cast
need forge
need python3

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

FORWARDER_KIND="${FORWARDER_KIND:-mock}"
FORWARDER_SOURCE="cre/notary/forwarders.json"
if [[ -n "${FORWARDER:-}" ]]; then
  FORWARDER_SOURCE="FORWARDER env"
elif [[ "$FORWARDER_KIND" == "production" ]]; then
  FORWARDER="$PROD_FORWARDER"
else
  FORWARDER="$MOCK_FORWARDER"
  FORWARDER_KIND="mock"
fi

if [[ "$CHECK_ONLY" == 0 && -z "${FORWARDER:-}" ]]; then
  echo "FORWARDER resolved empty" >&2
  exit 1
fi

refresh_from_cli() {
  [[ "$FORWARDER_SOURCE" == "FORWARDER env" ]] && return 0
  [[ "$FORWARDER_KIND" != "mock" ]] && return 0
  if ! command -v cre >/dev/null 2>&1; then
    echo "cre CLI not installed; using pinned MockKeystoneForwarder ${FORWARDER}"
    return 0
  fi
  if ! cre whoami --non-interactive >/dev/null 2>&1; then
    echo "cre workflow supported-chains skipped: not logged in and no CRE_API_KEY."
    echo "Using pinned MockKeystoneForwarder ${FORWARDER}"
    return 0
  fi
  local json addr
  if ! json="$(cre workflow supported-chains --output json --non-interactive 2>/dev/null)"; then
    echo "supported-chains failed; using pinned MockKeystoneForwarder ${FORWARDER}"
    return 0
  fi
  addr="$(python3 -c '
import json, sys
rows = json.loads(sys.argv[1])
name = sys.argv[2]
for row in rows:
    if row.get("chainName") == name and row.get("address"):
        print(row["address"])
        break
' "$json" "$CHAIN_NAME")"
  if [[ -z "$addr" ]]; then
    echo "supported-chains has no ${CHAIN_NAME} row; using pinned ${FORWARDER}"
    return 0
  fi
  if [[ "$(lower "$addr")" != "$(lower "$FORWARDER")" ]]; then
    echo "Tenant mock forwarder ${addr} differs from the docs pin ${FORWARDER}."
    echo "Using the tenant address from cre workflow supported-chains."
  else
    echo "supported-chains confirms MockKeystoneForwarder ${addr}"
  fi
  FORWARDER="$addr"
  FORWARDER_SOURCE="cre workflow supported-chains"
}

classify() {
  local f p m
  f="$(lower "$FORWARDER")"
  m="$(lower "$MOCK_FORWARDER")"
  p="$(lower "$PROD_FORWARDER")"
  if [[ "$f" == "$m" ]]; then FORWARDER_KIND="mock"
  elif [[ "$f" == "$p" ]]; then FORWARDER_KIND="production"
  else FORWARDER_KIND="custom"
  fi
}

refresh_from_cli
classify

echo "Chain: Base Sepolia (${CHAIN_NAME}, id 84532)"
echo "Forwarder (${FORWARDER_KIND}, ${FORWARDER_SOURCE}): ${FORWARDER}"
echo "RPC: ${RPC}"

chain_id="$(cast chain-id --rpc-url "$RPC")"
if [[ "$chain_id" != "84532" ]]; then
  echo "RPC chain id is ${chain_id}, expected 84532" >&2
  exit 1
fi
mock_size="$(cast codesize "$MOCK_FORWARDER" --rpc-url "$RPC")"
prod_size="$(cast codesize "$PROD_FORWARDER" --rpc-url "$RPC")"
fwd_size="$(cast codesize "$FORWARDER" --rpc-url "$RPC")"
echo "Bytecode bytes: mock=${mock_size} production=${prod_size} selected=${fwd_size}"
if [[ "$fwd_size" == "0" || "$mock_size" == "0" || "$prod_size" == "0" ]]; then
  echo "A forwarder address has no code on this RPC. Stop." >&2
  exit 1
fi

echo "Compiling LegalNotary..."
(cd contracts && forge build)

yaml_rpc="$(python3 -c '
import pathlib, re
text = pathlib.Path("cre/project.yaml").read_text()
urls = re.findall(r"https?://\S+", text)
print(urls[0] if urls else "")
')"
if [[ -n "$yaml_rpc" && "$yaml_rpc" != "$RPC" ]]; then
  echo "Note: deploy uses ${RPC} but cre/project.yaml broadcast RPC is ${yaml_rpc}."
fi

report_secrets() {
  if [[ -n "${CRE_ETH_PRIVATE_KEY:-}" ]]; then
    local pk="${CRE_ETH_PRIVATE_KEY#0x}"
    if [[ ! "$pk" =~ ^[0-9a-fA-F]{64}$ ]]; then
      echo "CRE_ETH_PRIVATE_KEY is set but is not 32 bytes of hex."
    else
      local addr bal
      addr="$(cast wallet address --private-key "0x${pk}")"
      bal="$(cast balance "$addr" --rpc-url "$RPC")"
      echo "Deployer ${addr} balance ${bal} wei (key not printed)."
    fi
  else
    echo "MISSING CRE_ETH_PRIVATE_KEY (Base Sepolia ETH on that EOA)."
  fi
  if command -v cre >/dev/null 2>&1 && cre whoami --non-interactive >/dev/null 2>&1; then
    echo "CRE auth: ok ($(cre --version 2>/dev/null || true))."
  else
    echo "MISSING CRE auth. Run cre login, or set CRE_API_KEY."
  fi
}

if [[ "$CHECK_ONLY" == 1 ]]; then
  python3 scripts/notary_config.py self-test
  report_secrets
  echo "Preflight ok. No contract was deployed and no transaction was sent."
  exit 0
fi

if [[ -z "${CRE_ETH_PRIVATE_KEY:-}" ]]; then
  echo "CRE_ETH_PRIVATE_KEY is not set. Copy .env.example to .env. See BLOCKERS.md." >&2
  exit 2
fi
PK_HEX="${CRE_ETH_PRIVATE_KEY#0x}"
if [[ ! "$PK_HEX" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "CRE_ETH_PRIVATE_KEY must be 32 bytes of hex, with or without 0x." >&2
  exit 2
fi
export CRE_ETH_PRIVATE_KEY="0x${PK_HEX}"
if [[ "$SKIP_BROADCAST" == 0 && "$FORWARDER_KIND" != "mock" ]]; then
  echo "Refusing simulate --broadcast with a ${FORWARDER_KIND} forwarder." >&2
  echo "That command calls MockKeystoneForwarder ${MOCK_FORWARDER}." >&2
  echo "LegalNotary would revert NotForwarder. Use the default mock forwarder," >&2
  echo "or pass --skip-broadcast to deploy a production receiver without a write." >&2
  exit 2
fi
DEPLOYER="$(cast wallet address --private-key "$CRE_ETH_PRIVATE_KEY")"
BALANCE="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
echo "Deployer ${DEPLOYER}"
python3 -c 'import sys; bal=int(sys.argv[1]); need=int(sys.argv[2]); raise SystemExit(0 if bal>=need else 1)' \
  "$BALANCE" "$MIN_WEI" || {
  echo "Balance ${BALANCE} wei is below ${MIN_WEI} wei." >&2
  echo "Fund ${DEPLOYER} from https://faucets.chain.link (Base Sepolia) and rerun." >&2
  exit 2
}

redact() {
  sed -e "s/${CRE_ETH_PRIVATE_KEY}//g" -e "s/${PK_HEX}//g"
}

EXISTING="$(python3 scripts/notary_config.py read-address "$CONFIG")"
NOTARY=""
DEPLOY_TX=""
JUST_DEPLOYED=0
if [[ "${FRESH_DEPLOY:-}" != "1" && "$(lower "$EXISTING")" != "0x0000000000000000000000000000000000000000" ]]; then
  existing_size="$(cast codesize "$EXISTING" --rpc-url "$RPC" || echo 0)"
  if [[ "$existing_size" != "0" ]]; then
    onchain_fwd="$(cast call "$EXISTING" "forwarder()(address)" --rpc-url "$RPC")"
    if [[ "$(lower "$onchain_fwd")" == "$(lower "$FORWARDER")" ]]; then
      NOTARY="$EXISTING"
      echo "Reusing LegalNotary ${NOTARY} (forwarder matches, code ${existing_size} bytes)."
    else
      echo "Configured ${EXISTING} forwarder is ${onchain_fwd}, not ${FORWARDER}. Deploying a new contract."
    fi
  else
    echo "Configured ${EXISTING} has no code. Deploying a new contract."
  fi
fi

if [[ -z "$NOTARY" ]]; then
  echo "Deploying LegalNotary..."
  FORGE_OUT="$(mktemp)"
  set +e
  (cd contracts && forge create src/LegalNotary.sol:LegalNotary \
    --rpc-url "$RPC" \
    --private-key "$CRE_ETH_PRIVATE_KEY" \
    --broadcast \
    --constructor-args "$FORWARDER") >"$FORGE_OUT" 2>&1
  forge_status=$?
  set -e
  redact <"$FORGE_OUT"
  if grep -q "$PK_HEX" "$FORGE_OUT"; then
    rm -f "$FORGE_OUT"
    echo "forge output contained the private key; aborting without saving it." >&2
    exit 1
  fi
  if [[ "$forge_status" != 0 ]]; then
    rm -f "$FORGE_OUT"
    echo "forge create failed." >&2
    exit 1
  fi
  PARSED="$(python3 scripts/notary_config.py parse-forge <"$FORGE_OUT")"
  rm -f "$FORGE_OUT"
  NOTARY="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["address"])' "$PARSED")"
  DEPLOY_TX="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["deployTx"])' "$PARSED")"
  onchain_fwd="$(cast call "$NOTARY" "forwarder()(address)" --rpc-url "$RPC")"
  if [[ "$(lower "$onchain_fwd")" != "$(lower "$FORWARDER")" ]]; then
    echo "Deployed ${NOTARY} forwarder() is ${onchain_fwd}, expected ${FORWARDER}." >&2
    exit 1
  fi
  python3 scripts/notary_config.py set-address "$CONFIG" "$NOTARY"
  echo "Wrote ${NOTARY} to ${CONFIG}"
  JUST_DEPLOYED=1
fi

if [[ -z "$DEPLOY_TX" && -f "$ROOT/deployments/base-sepolia.json" ]]; then
  DEPLOY_TX="$(python3 -c '
import json, sys
doc = json.load(open(sys.argv[1]))
if str(doc.get("address", "")).lower() == sys.argv[2].lower():
    tx = doc.get("deployTx") or ""
    if isinstance(tx, str):
        print(tx)
' "$ROOT/deployments/base-sepolia.json" "$NOTARY")"
fi

write_deployment() {
  local deploy_json="null" att_json="$1" att_ok="$2" count_json="$3" log_json="$4"
  [[ -n "$DEPLOY_TX" ]] && deploy_json="\"${DEPLOY_TX}\""
  python3 scripts/notary_config.py write-deployment "$ROOT/deployments/base-sepolia.json" <<EOF
{
  "network": "base-sepolia",
  "chainId": 84532,
  "chainSelectorName": "${CHAIN_NAME}",
  "contract": "LegalNotary",
  "address": "${NOTARY}",
  "deployer": "${DEPLOYER}",
  "deployTx": ${deploy_json},
  "forwarder": "${FORWARDER}",
  "forwarderKind": "${FORWARDER_KIND}",
  "forwarderSource": "${FORWARDER_SOURCE}",
  "attestationTx": ${att_json},
  "attestationOk": ${att_ok},
  "notaryCount": ${count_json},
  "log": ${log_json}
}
EOF
}

if [[ "$JUST_DEPLOYED" == 1 || ! -f "$ROOT/deployments/base-sepolia.json" ]]; then
  write_deployment null false null null
fi

if [[ "$SKIP_BROADCAST" == 1 ]]; then
  echo "Deploy step finished. Attestation was not broadcast."
  echo "NOTARY=${NOTARY}"
  exit 0
fi

if ! command -v cre >/dev/null 2>&1; then
  echo "cre CLI is not installed. Contract is deployed; attestation was not sent." >&2
  exit 1
fi
if ! cre whoami --non-interactive >/dev/null 2>&1; then
  echo "CRE auth missing after deploy. Notary ${NOTARY} is in ${CONFIG}." >&2
  echo "Set CRE_API_KEY or run cre login, then rerun this script. It will reuse the contract." >&2
  exit 2
fi

echo "Broadcasting cre workflow simulate --broadcast..."
mkdir -p "$ROOT/runs"
SIM_OUT="$(mktemp)"
set +e
CRE_ARGS=(workflow simulate notary --non-interactive --trigger-index 0 --http-payload "$PAYLOAD" -T "$TARGET" --broadcast)
if [[ -f "$ROOT/.env" ]]; then
  (cd "$ROOT/cre" && cre -e "$ROOT/.env" "${CRE_ARGS[@]}") >"$SIM_OUT" 2>&1
else
  (cd "$ROOT/cre" && cre "${CRE_ARGS[@]}") >"$SIM_OUT" 2>&1
fi
sim_status=$?
set -e
if grep -q "$PK_HEX" "$SIM_OUT"; then
  rm -f "$SIM_OUT"
  echo "CRE output contained the private key; not saving a log." >&2
  exit 1
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$ROOT/runs/broadcast-${stamp}.log"
redact <"$SIM_OUT" >"$LOG"
if [[ "$sim_status" != 0 ]]; then
  rm -f "$SIM_OUT"
  echo "cre workflow simulate --broadcast failed. Log: ${LOG}" >&2
  echo "No attestation tx recorded." >&2
  exit 1
fi
set +e
ATT_TX="$(python3 scripts/notary_config.py extract-tx <"$SIM_OUT")"
extract_status=$?
set -e
rm -f "$SIM_OUT"
if [[ "$extract_status" != 0 || -z "${ATT_TX:-}" ]]; then
  echo "Simulate finished without a non-zero tx. Log: ${LOG}" >&2
  exit 1
fi

RECEIPT="$(mktemp)"
receipt_ok=0
for _try in 1 2 3 4 5 6; do
  if cast receipt "$ATT_TX" --json --rpc-url "$RPC" >"$RECEIPT" 2>/dev/null; then
    receipt_ok=1
    break
  fi
  sleep 2
done
if [[ "$receipt_ok" != 1 ]]; then
  rm -f "$RECEIPT"
  echo "No receipt yet for ${ATT_TX}. Not marking the attestation verified." >&2
  exit 1
fi
python3 scripts/notary_config.py assert-receipt "$RECEIPT" "$NOTARY"
rm -f "$RECEIPT"
COUNT_RAW="$(cast call "$NOTARY" "count()(uint256)" --rpc-url "$RPC")"
COUNT="$(python3 -c 'import re,sys; m=re.search(r"\d+", sys.argv[1]); print(m.group(0) if m else "0")' "$COUNT_RAW")"
echo "LegalNotary.count() = ${COUNT}"
if [[ "$COUNT" == "0" ]]; then
  echo "Receipt reached the notary but count() is still 0. Not marking the attestation verified." >&2
  exit 1
fi

write_deployment "\"${ATT_TX}\"" true "\"${COUNT}\"" "\"runs/broadcast-${stamp}.log\""

echo "ATTESTATION_TX=${ATT_TX}"
echo "NOTARY=${NOTARY}"
echo "Log: ${LOG}"
