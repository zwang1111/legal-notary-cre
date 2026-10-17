# Legal Notary architecture

```mermaid
sequenceDiagram
    autonumber
    participant A as Paralegal agent (spend policy)
    participant G as x402 gateway (Hono)
    participant W as CRE workflow "legal-notary" (DON)
    participant L as GLEIF API
    participant C as LegalNotary.sol (Base Sepolia)
    A->>G: POST /notarize {contract, parties}
    G-->>A: 402 Payment Required (exact, base-sepolia, USDC, 10000 = 0.01)
    A->>A: check per-call cap and budget, sign EIP-3009 authorization
    A->>G: retry with X-PAYMENT
    G->>G: verify signature, payee, amount, validity window, nonce replay
    G->>W: HTTP trigger {request, payer, paymentRef}
    W->>L: HTTP capability: GET /lei-records/{LEI} per party (consensus)
    W->>W: deterministic clause checklist for the jurisdiction
    W->>C: signed report -> EVM write -> onReport(docHash, verdict, score, payer, jurisdiction, findingsHash)
    W-->>G: {verdict, score, docHash, tx}
    G-->>A: 200 + X-PAYMENT-RESPONSE
    A->>A: PASS -> file, REVIEW -> lawyer, FAIL -> block signing
```

## Components

| Component | File | Role |
|---|---|---|
| CRE workflow | `cre/notary/main.ts` | Orchestration layer: HTTP trigger, HTTP capability (GLEIF), report, EVM write |
| Workflow logic | `cre/notary/logic.ts` | Pure functions: LEI ISO 17442 checksum, GLEIF interpretation, clause rules, ABI encoding |
| Receiver contract | `contracts/src/LegalNotary.sol` | `IReceiver.onReport`, accepts reports only from the Keystone forwarder, optional workflow-ID lock |
| x402 gateway | `gateway/src/gateway.ts`, `gateway/src/x402.ts` | x402 v1 `exact` scheme (EIP-3009 USDC on Base Sepolia); verifies locally or settles via a facilitator |
| Runner | `gateway/src/runner.ts` | `simulate` = real `cre workflow simulate`; `harness` = labelled local stand-in |
| Agent | `gateway/src/agent.ts` | Buyer agent with per-call cap and total budget |

## Trust and privacy
- Only hashes go onchain: `docHash = keccak256(contract text)` and `findingsHash`. The contract text stays off-chain.
- GLEIF lookups run inside the workflow, so every DON node fetches independently and the result goes through consensus.
- The receiver accepts reports only from the configured forwarder, and optionally only from one workflow ID.
- Payment: the gateway checks the EIP-3009 authorization (signature, `payTo`, amount, `validAfter`/`validBefore`, nonce replay) before running the workflow.

## Evidence
- `runs/demo-20261017-130655.log`: end-to-end run. The agent pays via x402, the gateway triggers the real `cre workflow simulate`, and the payer and x402 reference reach the workflow. Results: PASS 100 (DE SaaS MSA) and FAIL 22 (US draft).
- `runs/cre-simulate-20261016.log`: standalone `cre workflow simulate` (CRE CLI v1.38.0).
- The EVM write is a dry run (no `--broadcast`, `notaryAddress` = 0x0). The CRE CLI prints local time with a `Z` suffix; the real UTC time is 8 hours earlier.
