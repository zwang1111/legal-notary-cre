# Video script (~3:20, silent captions; rendered by scripts/render-video.py → /workspace/legal-cre-demo.mp4)

1. (0:00) Title — "Legal Notary on Chainlink CRE: AI agents pay per call with x402 for verifiable contract checks."
2. (0:18) Problem — agents review contracts; KYB and compliance are manual, private, unprovable; API keys don't suit agents.
3. (0:42) Architecture — agent → x402 gateway (402, 0.01 USDC) → signed EIP-3009 → CRE HTTP trigger → GLEIF + clause checks → report → LegalNotary on Base Sepolia.
4. (1:12) Build & test — 7 TS tests, 4 Foundry tests, `cre workflow build` → WASM.
5. (1:34) PASS run — German SaaS MSA: both LEIs active, all clauses incl. GDPR Art. 28 → PASS 100.
6. (2:06) FAIL run — US draft: bad LEI checksum, unlimited liability, no governing law → FAIL; agent blocks signing.
7. (2:36) Status & next — harness vs `cre workflow simulate` (after login) and `--broadcast`; next: CRE deploy, LLM clause extraction, sanctions screening.

Before submitting: re-record step 5/6 with `CRE_MODE=simulate scripts/demo.sh` after `cre login`, optionally add voice-over.
