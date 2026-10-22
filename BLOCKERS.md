# Blockers: cleared for Base Sepolia attestation

As of 2026-10-23 (Asia/Shanghai), `LegalNotary` is deployed on Base Sepolia and a non-zero attestation was broadcast and receipt-verified. See [`deployments/base-sepolia.json`](deployments/base-sepolia.json) and the README Status / Deployment sections.

| field | value |
|---|---|
| address | `0x8e457Ed0e713094e4AB70a098233E5816A44271B` |
| deployTx | `0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159` |
| attestationTx | `0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119` |
| forwarder | MockKeystoneForwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` |
| `count()` | `1` |

## Remaining notes (not blockers for the attestation above)

- CRE **Deploy Access** for this org is still "Not enabled". That matters for `cre workflow deploy` / production KeystoneForwarder registration, not for `cre workflow simulate --broadcast` against the mock forwarder.
- Force the mock forwarder when re-running: `FORWARDER=0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5 FORWARDER_KIND=mock`. Without that override, `supported-chains` can hand the production KeystoneForwarder and a broadcast would revert `NotForwarder`.
- Do not commit `.env`, `cre/.env`, or `~/.cre/cre.yaml`.
