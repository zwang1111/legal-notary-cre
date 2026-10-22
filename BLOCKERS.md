# Blockers: cleared for Base Sepolia attestation

As of 2026-10-23 (Asia/Shanghai), `LegalNotary` is deployed on Base Sepolia and a non-zero attestation was broadcast and receipt-verified. See [`deployments/base-sepolia.json`](deployments/base-sepolia.json) and the README Status / Deployment sections.

| field | value |
|---|---|
| address | `0x8e457Ed0e713094e4AB70a098233E5816A44271B` |
| deployTx | `0x40a5895c731fb2127d6e3a70e2fcfa012b06cad2b932bd79ea7a0a12f61f7159` |
| attestationTx | `0x16904215515adb37651bfe661d1b9988c3db198567afab0aebe37127c22fb119` |
| forwarder | MockKeystoneForwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` |
| `count()` | `1` |
| log | [`runs/broadcast-20261022T170550Z.log`](runs/broadcast-20261022T170550Z.log) |

## How that deploy chose the forwarder

The recorded run set `FORWARDER=0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` and `FORWARDER_KIND=mock` (`forwarderSource` in the JSON is `FORWARDER env`). That override was required at the time: `cre workflow supported-chains --output json` field `address` is the production KeystoneForwarder (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`), and the script used to pass `address` into the constructor. `simulate --broadcast` calls MockKeystoneForwarder, so a production constructor reverts `NotForwarder`.

The script now reads **`mockAddress`** for the broadcast path and does not fall back to `address`. If `mockAddress` is missing, it keeps the pin in `cre/notary/forwarders.json`. `FORWARDER` still overrides the constructor. `FORWARDER_KIND` defaults to `mock`. `FORWARDER_KIND=production` still refuses `--broadcast`.

## Remaining notes (not blockers for the attestation above)

- CRE **Deploy Access** for this org is still "Not enabled". That matters for `cre workflow deploy` / production KeystoneForwarder registration, not for `cre workflow simulate --broadcast` against the mock forwarder.
- Do not commit `.env`, `cre/.env`, or `~/.cre/cre.yaml`.
