# Legal Notary — an x402-paid Chainlink CRE workflow for contract KYB, compliance and attestation

**AI paralegal agents pay 0.01 USDC per call (x402) to a Chainlink CRE workflow that verifies counterparties in GLEIF, checks a contract's clauses for its jurisdiction, and produces a signed attestation for a Base Sepolia receiver contract.**

> **Status, stated plainly:** `LegalNotary` is **deployed on Base Sepolia** (chain id 84532). This is not mainnet. Address [`0x8e457Ed0e713094e4AB70a098233E5816A44271B`](https://sepolia.basescan.org/address/0x8e457Ed0e713094e4AB70a098233E5816A44271B). Deploy tx [`0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159`](https://sepolia.basescan.org/tx/0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159). One attestation was broadcast with `cre workflow simulate --broadcast` (CRE CLI v1.38.0) through the Base Sepolia **MockKeystoneForwarder** (`0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5`): tx [`0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119`](https://sepolia.basescan.org/tx/0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119), verdict **PASS / 100**, `count()=1`. Record: `deployments/base-sepolia.json`. CRE **Deploy Access** is still not enabled, so this is not `cre workflow deploy` and not the production KeystoneForwarder. DoraHacks BUIDL [49965](https://dorahacks.io/buidl/49965).

## Links
- 💻 Repo (public, MIT): https://github.com/zwang1111/legal-notary-cre
- 🏆 BUIDL: https://dorahacks.io/buidl/49965
- 🎬 Demo video (raw): https://github.com/zwang1111/legal-notary-cre/raw/main/demo.mp4
- 📐 Architecture: https://github.com/zwang1111/legal-notary-cre/blob/main/docs/ARCHITECTURE.md
- 📜 Contract: https://sepolia.basescan.org/address/0x8e457Ed0e713094e4AB70a098233E5816A44271B
- 🧪 Earlier dry-run simulation log (tx `0x0`, not an attestation): https://github.com/zwang1111/legal-notary-cre/blob/main/runs/cre-simulate-20261016.log
- 📡 Broadcast log: https://github.com/zwang1111/legal-notary-cre/blob/main/runs/broadcast-20261022T170550Z.log
- 🔁 End-to-end run (agent → x402 → CRE simulate): https://github.com/zwang1111/legal-notary-cre/blob/main/runs/demo-20261017-130655.log

## Problem
Contract review is moving to AI agents, but counterparty KYB and compliance checks remain manual, private and unprovable, and API keys don't suit agents that pay per use.

## How it works
1. The agent POSTs a contract to an x402-protected endpoint and gets **HTTP 402** (exact scheme, Base Sepolia USDC, 0.01).
2. It signs an **EIP-3009** authorization within its spend policy (per-call cap and total budget) and retries. The gateway verifies signature, payee, amount, validity window and nonce replay, then triggers the CRE workflow over HTTP.
3. The **CRE workflow** (TypeScript SDK) looks up every party's LEI in the **GLEIF API** with DON consensus, then runs a deterministic clause checklist: governing law, forum, liability cap, termination, confidentiality, signatures, GDPR Art. 28 for EU contracts, and no unlimited liability.
4. It builds a signed **CRE report** (doc hash, verdict, score, payer, jurisdiction, findings hash) for the `LegalNotary` receiver (`IReceiver.onReport`, forwarder-only, optional workflow-ID lock) on Base Sepolia. Only hashes go on-chain, never the document. One such report is already on Base Sepolia (see Status).
5. The agent acts on the verdict: `PASS` → file, `REVIEW` → route to a lawyer, `FAIL` → block signing.

## Proof
Broadcast on Base Sepolia (`cre workflow simulate --broadcast`, 2026-10-23, log `runs/broadcast-20261022T170550Z.log`). The receiver was the deployed notary; the forwarder was MockKeystoneForwarder. `count()` after the receipt was `1`.

```
[USER LOG] [3] verdict PASS, score 100, docHash 0xf1744db7…b96d
[USER LOG] [4] attestation written to LegalNotary 0x8e457Ed0…271B: 0x16904215…b119
✓ Workflow Simulation Result: {"verdict":"PASS","score":100,"docHash":"0xf1744db7…b96d","tx":"0x16904215…b119"}
```

An earlier standalone simulate (2026-10-16, `runs/cre-simulate-20261016.log`) compiled to the same binary hash `bcc166ba…7965` and returned `tx` `0x0`. That hash is a dry run, not this attestation.

End to end behind the x402 gateway (2026-10-17, `runs/demo-20261017-130655.log`): **PASS 100** for a German SaaS MSA and **FAIL 22** for a risky US draft (bad LEI checksum, unlimited liability). The payer address and x402 reference reach the workflow. That run did not use `--broadcast`.

## Chainlink "Best workflow with CRE" fit
- CRE as orchestration layer: HTTP trigger → HTTP capability (GLEIF) → report → EVM write (`cre/notary/main.ts`).
- Blockchain + external API: one EVM write on Base Sepolia (`LegalNotary` via MockKeystoneForwarder, `simulate --broadcast`) + GLEIF REST API, invoked by an AI agent paying via x402. This matches the sponsor's use case "AI agents consuming CRE workflows with x402 payments".
- Successful CRE CLI simulation, plus one receipt-backed Base Sepolia attestation (log linked above). Production workflow registration is still blocked: CRE Deploy Access is not enabled.

## Honest status
- `cre workflow build` compiles to WASM. 8 TypeScript tests and 4 Foundry tests pass.
- `cre workflow simulate` passes standalone and end to end. The 2026-10-16 and 2026-10-17 logs are dry runs (`tx` `0x0`).
- **Done on Base Sepolia:** `LegalNotary` at `0x8e457Ed0e713094e4AB70a098233E5816A44271B` (deploy tx `0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159`). `scripts/deploy-base-sepolia.sh` then ran `cre workflow simulate --broadcast` against MockKeystoneForwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5`. Attestation tx `0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119` (PASS / 100, `count()=1`). See `deployments/base-sepolia.json`.
- **Not done:** not mainnet. CRE Deploy Access for this org is still not enabled, so there is no `cre workflow deploy` and no production KeystoneForwarder registration. See `BLOCKERS.md`.
- x402 payments are verified locally by default, so no funds move. Facilitator settlement on Base Sepolia is supported via `FACILITATOR_URL`.

## Tech
Chainlink CRE TypeScript SDK + CRE CLI v1.38 · x402 (exact / EIP-3009) · USDC · Solidity 0.8 (Foundry) · Base Sepolia (deployed; mock-forwarder broadcast) · Hono · viem · GLEIF API.

*Not legal advice; this is an audit trail. Built with AI assistance (coding agent), with all code reviewed and tested.*
