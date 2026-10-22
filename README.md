# Legal Notary — a Chainlink CRE workflow AI agents pay for with x402

> 📐 **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (sequence diagram, components, trust model, evidence)
> · 🎬 **Video:** [`demo.mp4`](demo.mp4) · 🧪 **Simulation log:** [`runs/cre-simulate-20261016.log`](runs/cre-simulate-20261016.log)

> **Status:** `LegalNotary` is **deployed on Base Sepolia** and a real attestation was written with `cre workflow simulate --broadcast` (CRE CLI v1.38.0).
> Contract: [`0x8e457Ed0e713094e4AB70a098233E5816A44271B`](https://sepolia.basescan.org/address/0x8e457Ed0e713094e4AB70a098233E5816A44271B) · deploy tx [`0x40a5895c…7159`](https://sepolia.basescan.org/tx/0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159) · attestation tx [`0x16904215…b119`](https://sepolia.basescan.org/tx/0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119) (`count()=1`, MockKeystoneForwarder).
> Record: [`deployments/base-sepolia.json`](deployments/base-sepolia.json) · log: [`runs/broadcast-20261022T170550Z.log`](runs/broadcast-20261022T170550Z.log). Dry-run `0x0` hashes are not attestations; this one is non-zero and receipt-verified.

An AI paralegal agent pays **0.01 USDC per call via x402** to run a **Chainlink CRE workflow** that
1. verifies every contracting party's **LEI against the GLEIF API** (CRE HTTP capability, DON consensus),
2. runs a **deterministic clause-compliance checklist** for the contract's jurisdiction (GDPR Art. 28 for EU, governing law, liability cap, signatures, …),
3. signs a **CRE report** and writes to the **`LegalNotary` receiver on Base Sepolia** (CRE EVM write capability) with the attestation (doc hash, verdict, score, payer, jurisdiction). A Base Sepolia broadcast has been executed; see Status and Deployment below.

The agent then acts on the verdict: `PASS` → file, `REVIEW` → route to a lawyer, `FAIL` → block signing.
The document itself never goes onchain, only its keccak256 hash. Not legal advice; it's an audit trail.

Built for BLI Legal Tech Hackathon 2, Chainlink "Best workflow with CRE" bounty. It follows the official
*AI agents consuming CRE workflows with x402 payments* pattern (`smartcontractkit/cre_x402_smartcon_demo`,
`smartcontractkit/x402-cre-price-alerts`).

```
agent ──POST /notarize──▶ x402 gateway ──402 {exact, base-sepolia, USDC, 10000}──▶ agent
agent ──X-PAYMENT (EIP-3009 sig)──▶ gateway verifies ──HTTP trigger──▶ CRE workflow legal-notary
   CRE: GLEIF lookups ▸ clause checks ▸ report ▸ writeReport ▸ LegalNotary.sol (Base Sepolia; live write via MockKeystoneForwarder)
```

Full sequence diagram, trust model and evidence: **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Layout
| path | what |
|---|---|
| `cre/notary/main.ts` | CRE TypeScript workflow (HTTP trigger → HTTP capability → report → EVM write) |
| `cre/notary/logic.ts` | pure, deterministic checks (LEI ISO 17442 checksum, GLEIF interpretation, clause rules, ABI encoding) |
| `contracts/src/LegalNotary.sol` | CRE receiver (`IReceiver.onReport`), forwarder-only, optional workflow-ID lock |
| `scripts/deploy-base-sepolia.sh` | Deploy on Base Sepolia, write `notaryAddress`, `cre workflow simulate --broadcast` |
| `cre/notary/forwarders.json` | Pinned MockKeystoneForwarder and KeystoneForwarder for Base Sepolia |
| `gateway/src/x402.ts` | x402 v1 `exact` scheme for Base Sepolia USDC (client sign + server verify; optional facilitator settle) |
| `gateway/src/gateway.ts` | x402-protected `POST /notarize` → runs the CRE workflow |
| `gateway/src/runner.ts` | `simulate` = real `cre workflow simulate`; `harness` = local stand-in (same logic, live GLEIF, no chain write) |
| `gateway/src/agent.ts` | paralegal agent with spend policy (per-call cap + budget) |
| `samples/` | a clean German SaaS MSA (PASS) and a risky US draft (FAIL) |

## Run
```bash
curl -sSL https://cre.chain.link/install.sh | bash      # CRE CLI (tested with v1.38.0); needs bun
(cd cre/notary && bun install) && (cd gateway && npm install)
scripts/demo.sh            # tests + forge tests + cre workflow build + gateway + paying agent
```
`demo.sh` uses real `cre workflow simulate` when you're logged in (`cre login` or `CRE_API_KEY`), otherwise it falls back to the
labelled local harness. **Note: CRE CLI v1.38 requires login even for `simulate` (and `init`); `cre workflow build` works without it.**

Direct simulation:
```bash
cd cre && cre workflow simulate notary --non-interactive --trigger-index 0 \
  --http-payload "$(cat ../samples/saas-de.json)" -T local-simulation
# A real write is `scripts/deploy-base-sepolia.sh` (deploys, then simulate --broadcast).
# It needs CRE_ETH_PRIVATE_KEY, Base Sepolia ETH, and `cre login` or CRE_API_KEY. See BLOCKERS.md.
```
Real simulation output (2026-10-16):
```
✓ Workflow compiled   Binary hash: bcc166ba…7965
[USER LOG] [2] GLEIF 7LTWFZYICNSX8D621K86: OK active LEI, name matches
[USER LOG] [2] GLEIF 5493001KJTIIGC8Y1R12: OK active LEI, name matches
[USER LOG] [3] verdict PASS, score 100, docHash 0xf1744db7…b96d
✓ Workflow Simulation Result: {"verdict":"PASS","score":100,"docHash":"0xf1744db7…b96d","tx":"0x000…0"}
```
Full log: `runs/cre-simulate-20261016.log` (CRE CLI v1.38.0, 2026-10-16, exit 0).

End-to-end with the paying agent (2026-10-17, `CRE_MODE=simulate scripts/demo.sh`): agent gets 402, signs the EIP-3009 authorization, and the gateway
runs the **real `cre workflow simulate`** with the payer address and x402 reference in the payload. Results: PASS 100 (DE MSA) and FAIL 22 (US draft, bad LEI checksum,
unlimited liability). Log: `runs/demo-20261017-130655.log`; console: `runs/demo-console.txt`.

Earlier dry runs without `--broadcast` (and with `notaryAddress` still 0x0) returned tx hash 0x0. That is not an on-chain write; the Base Sepolia broadcast above is.

## Deployment (Base Sepolia executed)

| field | value |
|---|---|
| network | Base Sepolia (`84532`, `ethereum-testnet-sepolia-base-1`) |
| `LegalNotary` | [`0x8e457Ed0e713094e4AB70a098233E5816A44271B`](https://sepolia.basescan.org/address/0x8e457Ed0e713094e4AB70a098233E5816A44271B) |
| deploy tx | [`0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159`](https://sepolia.basescan.org/tx/0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159) |
| attestation tx | [`0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119`](https://sepolia.basescan.org/tx/0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119) |
| forwarder | MockKeystoneForwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` |
| `count()` after broadcast | `1` |
| record | [`deployments/base-sepolia.json`](deployments/base-sepolia.json) |
| log | [`runs/broadcast-20261022T170550Z.log`](runs/broadcast-20261022T170550Z.log) |

`cre/notary/config.staging.json` now points at that notary. Re-run path for a funded test key:

1. Copy `.env.example` to `.env` (gitignored). Set `CRE_ETH_PRIVATE_KEY` and either `cre login` or `CRE_API_KEY`.
2. `scripts/deploy-base-sepolia.sh --check` confirms Base Sepolia chain id 84532 and that both forwarders have bytecode. It does not send a transaction.
3. Prefer `FORWARDER=0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5 FORWARDER_KIND=mock scripts/deploy-base-sepolia.sh` so the constructor matches what `simulate --broadcast` calls (do not let a tenant production forwarder override).
4. The script exits 0 only after `cast receipt` shows a successful log from that notary and `count()` is non-zero. A dry-run hash of `0x0` is a failure.

Constructor argument for this broadcast path, checked against the [CRE forwarder directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts) on 2026-10-22:

| use | contract | Base Sepolia address |
|---|---|---|
| `cre workflow simulate --broadcast` | MockKeystoneForwarder | `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` |
| `cre workflow deploy` (not this script's broadcast) | KeystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |

Chain selector name: `ethereum-testnet-sepolia-base-1`. When `cre whoami` works, the script prefers the mock address from `cre workflow supported-chains --output json` if the tenant row differs. Do not point a simulation broadcast at the production forwarder: `onReport` would revert `NotForwarder`. Leave `expectedWorkflowId` unset for simulation; the mock forwarder does not send workflow metadata.

## Payments
Default: the gateway **verifies the EIP-3009 authorization locally** (signature, payee, amount, validity window, nonce replay) and
does **not** settle — no funds move. Set `FACILITATOR_URL=https://x402.org/facilitator` and a Base Sepolia USDC-funded `AGENT_PK` to settle on testnet.

## Tests
`cd gateway && npm test` (8: LEI checksum, clause rules, GLEIF interpretation, verdict + ABI payload, x402 verify/replay/underpay/payTo, broadcast rejects a zero tx and an unset notary, harness, end-to-end agent with spend policy) · `cd contracts && forge test` (4).

## Reuse
x402 buyer/provider structure and video renderer adapted from `climate-x402`; agent spend-policy idea from `celo-agent`.
Built with AI assistance (coding agent); all code reviewed and tested.

## Demo video

[`demo.mp4`](demo.mp4) (3:48, ≈4 MB, silent with captions): x402 payment → real `cre workflow simulate` → verdict/attestation. Download it, or use the raw link:
https://github.com/zwang1111/legal-notary-cre/raw/main/demo.mp4

## License
MIT (see `LICENSE`).
