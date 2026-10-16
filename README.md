# Legal Notary — a Chainlink CRE workflow AI agents pay for with x402

An AI paralegal agent pays **0.01 USDC per call via x402** to run a **Chainlink CRE workflow** that
1. verifies every contracting party's **LEI against the GLEIF API** (CRE HTTP capability, DON consensus),
2. runs a **deterministic clause-compliance checklist** for the contract's jurisdiction (GDPR Art. 28 for EU, governing law, liability cap, signatures, …),
3. signs a **CRE report** and writes the attestation (doc hash, verdict, score, payer, jurisdiction) to the **`LegalNotary` receiver on Base Sepolia** (CRE EVM write capability).

The agent then acts on the verdict: `PASS` → file, `REVIEW` → route to a lawyer, `FAIL` → block signing.
The document itself never goes onchain, only its keccak256 hash. Not legal advice; it's an audit trail.

Built for BLI Legal Tech Hackathon 2, Chainlink "Best workflow with CRE" bounty. It follows the official
*AI agents consuming CRE workflows with x402 payments* pattern (`smartcontractkit/cre_x402_smartcon_demo`,
`smartcontractkit/x402-cre-price-alerts`).

```
agent ──POST /notarize──▶ x402 gateway ──402 {exact, base-sepolia, USDC, 10000}──▶ agent
agent ──X-PAYMENT (EIP-3009 sig)──▶ gateway verifies ──HTTP trigger──▶ CRE workflow legal-notary
   CRE: GLEIF lookups ▸ clause checks ▸ report ▸ writeReport ▸ LegalNotary.sol (Base Sepolia)
```

## Layout
| path | what |
|---|---|
| `cre/notary/main.ts` | CRE TypeScript workflow (HTTP trigger → HTTP capability → report → EVM write) |
| `cre/notary/logic.ts` | pure, deterministic checks (LEI ISO 17442 checksum, GLEIF interpretation, clause rules, ABI encoding) |
| `contracts/src/LegalNotary.sol` | CRE receiver (`IReceiver.onReport`), forwarder-only, optional workflow-ID lock |
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
# add --broadcast (with CRE_ETH_PRIVATE_KEY of a Base Sepolia test wallet) to really write via the MockKeystoneForwarder
```
Deploy `LegalNotary` with the Base Sepolia (Mock)KeystoneForwarder address from `cre workflow supported-chains`, then put it in `cre/notary/config.staging.json` → `notaryAddress`.

## Payments
Default: the gateway **verifies the EIP-3009 authorization locally** (signature, payee, amount, validity window, nonce replay) and
does **not** settle — no funds move. Set `FACILITATOR_URL=https://x402.org/facilitator` and a Base Sepolia USDC-funded `AGENT_PK` to settle on testnet.

## Tests
`cd gateway && npm test` (7: LEI checksum, clause rules, GLEIF interpretation, verdict + ABI payload, x402 verify/replay/underpay/payTo, harness, end-to-end agent with spend policy) · `cd contracts && forge test` (4).

## Reuse
x402 buyer/provider structure and video renderer adapted from `climate-x402`; agent spend-policy idea from `celo-agent`.
Built with AI assistance (coding agent); all code reviewed and tested.
