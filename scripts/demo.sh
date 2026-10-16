#!/usr/bin/env bash
# One-command demo. Testnet / local only; no funds move unless FACILITATOR_URL + funded AGENT_PK are set.
set -euo pipefail; cd "$(dirname "$0")/.."; export PATH="$HOME/.cre/bin:$HOME/.foundry/bin:$PATH"
mkdir -p runs; LOG="runs/demo-$(date +%Y%m%d-%H%M%S).log"
echo "== 1. unit + e2e tests";  (cd gateway && npm test 2>&1 | grep -E "^# (tests|pass|fail)")
echo "== 2. contract tests";    (cd contracts && forge test 2>&1 | grep -E "Suite result|PASS|FAIL")
echo "== 3. compile CRE workflow to WASM"; (cd cre && cre workflow build notary 2>&1 | grep -E "compiled|hash")
if [ -z "${CRE_MODE:-}" ]; then
  if cre whoami >/dev/null 2>&1 || [ -n "${CRE_API_KEY:-}" ]; then CRE_MODE=simulate; else CRE_MODE=harness; echo "   (not logged in to CRE: using local harness; run 'cre login' for real 'cre workflow simulate')"; fi
fi
echo "== 4. x402 gateway (CRE_MODE=$CRE_MODE) + paying paralegal agent -> $LOG"
(cd gateway && CRE_MODE=$CRE_MODE PORT=8402 npx tsx src/gateway.ts) & GW=$!; trap 'kill $GW 2>/dev/null; pkill -f "tsx src/gateway.ts" 2>/dev/null || true' EXIT
for i in $(seq 30); do curl -sf localhost:8402/health >/dev/null && break; sleep 0.5; done
(cd gateway && npx tsx src/agent.ts) | tee "$LOG" | python3 -c '
import sys, json
for l in sys.stdin:
    e = json.loads(l); s = e["step"]
    print("  [agent]", s, {k: v for k, v in e.items() if k in ("docId","amount","network","status","mode","verdict","score","action","spent")})
    for x in e.get("logs") or []: print("        ", x)'
echo "== 5. gateway ledger"; curl -s localhost:8402/ledger | python3 -m json.tool | tee -a "$LOG" | head -30
