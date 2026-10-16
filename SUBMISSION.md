# DoraHacks BUIDL submission — BLI Legal Tech Hackathon 2

- Hackathon: https://dorahacks.io/hackathon/legal-hack-2026 (DoraHacks id 1904)
- Bounty: Chainlink "Best workflow with CRE — 2x $1,000" (https://dorahacks.io/hackathon/bounty/1362)
- Deadline: treat as **2026-10-31** (bli.tools: "October 31st is the deadline"; DoraHacks shows 2026/11/01 01:01 UTC = 11-01 09:01 Beijing)
- Track tags: Legal, Compliance, RegTech, AI, Blockchain

## Name
Legal Notary — x402-paid CRE workflow for contract KYB, compliance and onchain attestation

## One-liner
AI paralegal agents pay 0.01 USDC per call (x402) to a Chainlink CRE workflow that verifies counterparties in GLEIF, checks the contract's clauses for its jurisdiction, and notarizes the result on Base Sepolia.

## Description
Contract review is moving to AI agents, but counterparty KYB and compliance checks remain manual, private and unprovable. Legal Notary turns them into a pay-per-call, verifiable service:
1. The agent POSTs a contract to an x402-protected endpoint and gets HTTP 402 (exact scheme, Base Sepolia USDC).
2. It signs an EIP-3009 authorization under its spend policy and retries; the gateway verifies the payment and triggers the CRE workflow over HTTP.
3. The CRE workflow (TypeScript SDK) looks up each party's LEI in the GLEIF API with DON consensus, runs a deterministic clause checklist (governing law, forum, liability cap, termination, confidentiality, signatures, GDPR Art. 28 for EU, no unlimited liability), and writes a signed report (doc hash, verdict, score, payer, jurisdiction, findings hash) to the LegalNotary receiver contract.
4. The agent files, escalates or blocks the contract depending on the verdict. Only hashes go onchain.

## How it meets the CRE bounty requirements
- CRE workflow as orchestration layer: `cre/notary/main.ts` (HTTP trigger → HTTP capability → report → EVM write).
- Blockchain + external API: Base Sepolia (`LegalNotary.sol`) + GLEIF REST API, triggered by an AI agent (x402).
- Proof: real `cre workflow simulate` run (sample `samples/saas-de.json`):
```
✓ Workflow compiled   Binary hash: bcc166ba…7965
[USER LOG] [2] GLEIF 7LTWFZYICNSX8D621K86: OK active LEI, name matches
[USER LOG] [2] GLEIF 5493001KJTIIGC8Y1R12: OK active LEI, name matches
[USER LOG] [3] verdict PASS, score 100, docHash 0xf1744db7…b96d
✓ Workflow Simulation Result: {"verdict":"PASS","score":100,"docHash":"0xf1744db7…b96d","tx":"0x000…0"}
```
Full log: `runs/cre-simulate-20261016.log` (CRE CLI v1.38.0, 2026-10-16, exit 0). Simulated without `--broadcast` and with `notaryAddress` still 0x0, so the EVM write is a dry run (tx hash 0x0); no contract deployed yet.
- Matches the sponsor's listed use case "AI agents consuming CRE workflows with x402 payments".

## Links
- Repo: https://github.com/zwang1111/legal-notary-cre   (push the local commit to a public GitHub repo)
- Demo video: <VIDEO_URL> (upload /workspace/legal-cre-demo.mp4 to YouTube/Loom, unlisted is fine)
- LegalNotary on Base Sepolia: <ADDRESS> (optional, after deploy)

## Tech
Chainlink CRE TypeScript SDK + CRE CLI v1.38, x402 (exact / EIP-3009), Base Sepolia, USDC, Solidity 0.8 (Foundry), Hono, viem, GLEIF API.

## Honest status
- Workflow compiles to WASM with `cre workflow build`. 7 TS tests + 4 Foundry tests pass.
- Real `cre workflow simulate` passes (see above). The x402 agent part of the video still runs through the local harness. The video now also shows the real simulate output. No onchain write has happened yet: no `--broadcast`, no deployed LegalNotary.
- x402 payment is verified locally by default (no funds moved); facilitator settlement on Base Sepolia is supported via `FACILITATOR_URL`.
- Built with AI assistance (coding agent); disclosed here.
