# DoraHacks BUIDL submission — BLI Legal Tech Hackathon 2

- Hackathon: https://dorahacks.io/hackathon/legal-hack-2026 (DoraHacks id 1904)
- Bounty: Chainlink "Best workflow with CRE — 2x $1,000" (https://dorahacks.io/hackathon/bounty/1362)
- Deadline: treat as **2026-10-31** (bli.tools: "October 31st is the deadline"; DoraHacks shows 2026/11/01 01:01 UTC = 11-01 09:01 Beijing)
- Track tags: Legal, Compliance, RegTech, AI, Blockchain

## Name
Legal Notary — x402-paid CRE workflow for contract KYB, compliance and onchain attestation

## One-liner
AI paralegal agents pay 0.01 USDC per call (x402) to a Chainlink CRE workflow that verifies counterparties in GLEIF, checks the contract's clauses for its jurisdiction, and writes a signed attestation to `LegalNotary` on Base Sepolia (deployed; one `cre workflow simulate --broadcast` via MockKeystoneForwarder, PASS/100, `count()=1`; not mainnet; CRE Deploy Access still not enabled).

## Description
Contract review is moving to AI agents, but counterparty KYB and compliance checks remain manual, private and unprovable. Legal Notary turns them into a pay-per-call, verifiable service:
1. The agent POSTs a contract to an x402-protected endpoint and gets HTTP 402 (exact scheme, Base Sepolia USDC).
2. It signs an EIP-3009 authorization under its spend policy and retries; the gateway verifies the payment and triggers the CRE workflow over HTTP.
3. The CRE workflow (TypeScript SDK) looks up each party's LEI in the GLEIF API with DON consensus, runs a deterministic clause checklist (governing law, forum, liability cap, termination, confidentiality, signatures, GDPR Art. 28 for EU, no unlimited liability), and produces a signed report (doc hash, verdict, score, payer, jurisdiction, findings hash) for the LegalNotary receiver contract on Base Sepolia. One report has been broadcast there (PASS/100). Earlier simulates without `--broadcast` remain dry runs.
4. The agent files, escalates or blocks the contract depending on the verdict. Only hashes go onchain.

## How it meets the CRE bounty requirements
- CRE workflow as orchestration layer: `cre/notary/main.ts` (HTTP trigger → HTTP capability → report → EVM write).
- Blockchain + external API: EVM write to deployed `LegalNotary.sol` on Base Sepolia (MockKeystoneForwarder, `cre workflow simulate --broadcast`; not mainnet) + GLEIF REST API, triggered by an AI agent (x402).
- Proof of the on-chain write (`samples/saas-de.json`, CRE CLI v1.38.0, log `runs/broadcast-20261022T170550Z.log`):
```
[USER LOG] [3] verdict PASS, score 100, docHash 0xf1744db7…b96d
[USER LOG] [4] attestation written to LegalNotary 0x8e457Ed0…271B: 0x16904215…b119
✓ Workflow Simulation Result: {"verdict":"PASS","score":100,"docHash":"0xf1744db7…b96d","tx":"0x16904215…b119"}
```
`cast` receipt check: success, `count()=1`. Contract `0x8e457Ed0e713094e4AB70a098233E5816A44271B`. Deploy tx `0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159`. Attestation tx `0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119`. Forwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` (mock). Record: `deployments/base-sepolia.json`.
- Earlier dry run, still in the repo: `runs/cre-simulate-20261016.log` (2026-10-16, exit 0, binary hash `bcc166ba…7965`) was simulated without `--broadcast` and with `notaryAddress` still `0x0`, so its tx hash is `0x0`. That is not the attestation above.
- Matches the sponsor's listed use case "AI agents consuming CRE workflows with x402 payments".

## Links
- BUIDL: https://dorahacks.io/buidl/49965
- Repo: https://github.com/zwang1111/legal-notary-cre (public, MIT)
- Architecture: https://github.com/zwang1111/legal-notary-cre/blob/main/docs/ARCHITECTURE.md
- Demo video (raw): https://github.com/zwang1111/legal-notary-cre/raw/main/demo.mp4
- Broadcast log: https://github.com/zwang1111/legal-notary-cre/blob/main/runs/broadcast-20261022T170550Z.log
- Earlier dry-run log (tx `0x0`): https://github.com/zwang1111/legal-notary-cre/blob/main/runs/cre-simulate-20261016.log
- LegalNotary on Base Sepolia: `0x8e457Ed0e713094e4AB70a098233E5816A44271B` (https://sepolia.basescan.org/address/0x8e457Ed0e713094e4AB70a098233E5816A44271B). Deploy tx `0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159`. Attestation tx `0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119` via `cre workflow simulate --broadcast` and MockKeystoneForwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5`. Not mainnet. CRE Deploy Access is still not enabled (`BLOCKERS.md`).
- BUIDL description in this repo: `DORAHACKS_DESCRIPTION.md`

## Tech
Chainlink CRE TypeScript SDK + CRE CLI v1.38, x402 (exact / EIP-3009), Base Sepolia, USDC, Solidity 0.8 (Foundry), Hono, viem, GLEIF API.

## Honest status
- Workflow compiles to WASM with `cre workflow build`. 8 TS tests + 4 Foundry tests pass.
- Real `cre workflow simulate` passes, standalone and end-to-end behind the x402 gateway (2026-10-17: PASS 100 / FAIL 22, payer + x402 ref passed into the workflow; `runs/demo-20261017-130655.log`). The demo video shows that x402 → simulate path: https://github.com/zwang1111/legal-notary-cre/raw/main/demo.mp4. It does not itself show the later broadcast.
- On-chain write that did happen: Base Sepolia only, `cre workflow simulate --broadcast`, MockKeystoneForwarder, not mainnet. `LegalNotary` `0x8e457Ed0e713094e4AB70a098233E5816A44271B`, deploy tx `0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159`, attestation tx `0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119` (PASS/100, `count()=1`). CRE Deploy Access is still not enabled, so `cre workflow deploy` has not been run. See `BLOCKERS.md`.
- x402 payment is verified locally by default (no funds moved); facilitator settlement on Base Sepolia is supported via `FACILITATOR_URL`.
- Built with AI assistance (coding agent); disclosed here.
