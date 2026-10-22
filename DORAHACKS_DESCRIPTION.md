# Legal Notary — an x402-paid Chainlink CRE workflow for contract KYB, compliance and attestation

**AI paralegal agents pay 0.01 USDC per call (x402) to a Chainlink CRE workflow that verifies counterparties in GLEIF, checks a contract's clauses for its jurisdiction, and produces a signed attestation for a Base Sepolia receiver contract.**

> **Status, stated plainly:** the CRE workflow is **simulated end to end with `cre workflow simulate`** (CRE CLI v1.38.0), with the x402-paying agent in the loop. The on-chain write target is the `LegalNotary` contract on **Base Sepolia**. Deployment is **scripted and not executed**: the contract is not deployed, and in the simulation the EVM write is a dry run (no `--broadcast`, tx hash `0x0`). The command that would deploy and broadcast is `scripts/deploy-base-sepolia.sh`. It has not produced a transaction. See `BLOCKERS.md`.

## Links
- 💻 Repo (public, MIT): https://github.com/zwang1111/legal-notary-cre
- 🎬 Demo video: https://github.com/zwang1111/legal-notary-cre/blob/main/demo.mp4 (raw download: https://github.com/zwang1111/legal-notary-cre/raw/main/demo.mp4)
- 📐 Architecture: https://github.com/zwang1111/legal-notary-cre/blob/main/docs/ARCHITECTURE.md
- 🧪 Simulation log: https://github.com/zwang1111/legal-notary-cre/blob/main/runs/cre-simulate-20261016.log
- 🔁 End-to-end run (agent → x402 → CRE simulate): https://github.com/zwang1111/legal-notary-cre/blob/main/runs/demo-20261017-130655.log

## Problem
Contract review is moving to AI agents, but counterparty KYB and compliance checks remain manual, private and unprovable, and API keys don't suit agents that pay per use.

## How it works
1. The agent POSTs a contract to an x402-protected endpoint and gets **HTTP 402** (exact scheme, Base Sepolia USDC, 0.01).
2. It signs an **EIP-3009** authorization within its spend policy (per-call cap and total budget) and retries. The gateway verifies signature, payee, amount, validity window and nonce replay, then triggers the CRE workflow over HTTP.
3. The **CRE workflow** (TypeScript SDK) looks up every party's LEI in the **GLEIF API** with DON consensus, then runs a deterministic clause checklist: governing law, forum, liability cap, termination, confidentiality, signatures, GDPR Art. 28 for EU contracts, and no unlimited liability.
4. It builds a signed **CRE report** (doc hash, verdict, score, payer, jurisdiction, findings hash) for the `LegalNotary` receiver (`IReceiver.onReport`, forwarder-only, optional workflow-ID lock) on Base Sepolia. Only hashes are meant to go on-chain, never the document.
5. The agent acts on the verdict: `PASS` → file, `REVIEW` → route to a lawyer, `FAIL` → block signing.

## Proof (real `cre workflow simulate` output)
```
✓ Workflow compiled   Binary hash: bcc166ba…7965
[USER LOG] [2] GLEIF 7LTWFZYICNSX8D621K86: OK active LEI, name matches
[USER LOG] [2] GLEIF 5493001KJTIIGC8Y1R12: OK active LEI, name matches
[USER LOG] [3] verdict PASS, score 100, docHash 0xf1744db7…b96d
✓ Workflow Simulation Result: {"verdict":"PASS","score":100,"docHash":"0xf1744db7…b96d","tx":"0x000…0"}
```
End to end behind the x402 gateway (2026-10-17): **PASS 100** for a German SaaS MSA and **FAIL 22** for a risky US draft (bad LEI checksum, unlimited liability). The payer address and x402 reference reach the workflow. `tx 0x0` means the EVM write was simulated, not broadcast.

## Chainlink "Best workflow with CRE" fit
- CRE as orchestration layer: HTTP trigger → HTTP capability (GLEIF) → report → EVM write (`cre/notary/main.ts`).
- Blockchain + external API: EVM write targeting Base Sepolia + GLEIF REST API, invoked by an AI agent paying via x402. This matches the sponsor's use case "AI agents consuming CRE workflows with x402 payments".
- Successful CRE CLI simulation (log linked above).

## Honest status
- `cre workflow build` compiles to WASM. 8 TypeScript tests and 4 Foundry tests pass.
- `cre workflow simulate` passes standalone and end to end.
- **Not done yet:** no `LegalNotary` deployment and no on-chain write. `scripts/deploy-base-sepolia.sh` deploys against the Base Sepolia MockKeystoneForwarder (`0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5`), writes `notaryAddress`, and runs `cre workflow simulate --broadcast`. It stops unless the receipt shows a non-zero attestation. The missing key, CRE login, and Base Sepolia ETH are listed in `BLOCKERS.md`.
- x402 payments are verified locally by default, so no funds move. Facilitator settlement on Base Sepolia is supported via `FACILITATOR_URL`.

## Tech
Chainlink CRE TypeScript SDK + CRE CLI v1.38 · x402 (exact / EIP-3009) · USDC · Solidity 0.8 (Foundry) · Base Sepolia (target) · Hono · viem · GLEIF API.

*Not legal advice; this is an audit trail. Built with AI assistance (coding agent), with all code reviewed and tested.*
