# Blockers: no Base Sepolia attestation in this change

`LegalNotary` is not deployed. `cre/notary/config.staging.json` still has `notaryAddress` `0x0000000000000000000000000000000000000000`. There is no attestation transaction hash to publish. The dry-run hash from `runs/cre-simulate-20261016.log` is 64 zero bytes. That is not an on-chain write.

The README status stays "not executed" on purpose.

## What was checked on 2026-10-22

Public RPC `https://sepolia.base.org` (chain id `84532`, `0x14a34`):

| contract | address | bytecode size |
|---|---|---|
| MockKeystoneForwarder (use this for `simulate --broadcast`) | `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5` | 4529 bytes |
| KeystoneForwarder (use this only for `cre workflow deploy`) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | 8591 bytes |

Addresses come from the CRE forwarder directory, fetched the same day: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts (page last updated 2026-09-18). Chain name in `cre/project.yaml` is `ethereum-testnet-sepolia-base-1`. They are also pinned in `cre/notary/forwarders.json`. EIP-55 checksum of the mock address is the value in that file; the directory prints the same 20 bytes with a different hex case.

`cre workflow supported-chains --output json` (CLI v1.39) returns both on each row. `mockAddress` is the mock forwarder above. `address` is the production forwarder above. The deploy script's broadcast path reads `mockAddress` only. `FORWARDER` overrides that. `FORWARDER_KIND` defaults to `mock`.

`cre workflow supported-chains` was **not** run against a tenant. CRE CLI v1.39.0 is installed here and both of these commands exit 1 before any workflow work:

```text
cre whoami --non-interactive
cre workflow simulate notary --non-interactive --trigger-index 0 --broadcast -T local-simulation
```

```text
! You are not logged in
✗ Authentication required: not logged in and no CRE_API_KEY set
  → Run 'cre login' interactively, or
  → Set CRE_API_KEY environment variable for non-interactive use
```

`cre workflow build notary` does compile on CLI v1.39.0 (binary hash `806884c0f09adf4785b2274274b6070f514890742a47c93ca377265af6d6fd6e`). That hash is a compile, not a simulation and not a transaction. The simulation evidence in `runs/` is still the v1.38.0 dry run.

No `CRE_ETH_PRIVATE_KEY`, `CRE_API_KEY`, or funded deployer was present in the environment. No faucet was called. No transaction was submitted.

## What you need to set

Put these in a repo-root `.env` (gitignored; `.env.example` lists them). The deploy script also accepts variables that are already exported. It does not print the key.

| variable | required for | where it comes from |
|---|---|---|
| `CRE_ETH_PRIVATE_KEY` | `forge create` and `cre workflow simulate --broadcast` | A fresh test EOA. 32-byte hex, `0x` optional. |
| Base Sepolia ETH on that EOA | gas for the deploy and the attestation | https://faucets.chain.link (Base Sepolia) or https://docs.base.org/chain/network-faucets. `0.001 ETH` covers typical testnet gas for both transactions. The script refuses to deploy below `0.00005 ETH` (`NOTARY_MIN_WEI` overrides that floor). |
| `cre login` **or** `CRE_API_KEY` | every `cre workflow simulate`, including `--broadcast`, and `cre workflow supported-chains` | Browser login: https://docs.chain.link/cre/account/cli-login. API key: CRE platform → Organization → APIs → **+ Organization API**. API keys need deploy access (`cre account access`). https://docs.chain.link/cre/reference/cli/authentication |
| `BASE_SEPOLIA_RPC_URL` | optional deploy/receipt RPC | Default `https://sepolia.base.org`. Broadcast reads `cre/project.yaml`, which uses the same URL. Change both together if you switch. |

Do not commit `.env`, `cre/.env`, or `~/.cre/cre.yaml`.

## Command once those exist

```bash
scripts/deploy-base-sepolia.sh --check
scripts/deploy-base-sepolia.sh
```

What the second command does:

1. If you are logged in, read **`mockAddress`** for `ethereum-testnet-sepolia-base-1` from `cre workflow supported-chains --output json`. On CLI v1.39 that field is the MockKeystoneForwarder. The sibling field **`address`** is the production KeystoneForwarder (`0xF8344CFd…`); the script ignores it. Using `address` as the constructor makes `simulate --broadcast` revert `NotForwarder`. If `mockAddress` is absent, the pinned mock above is kept. Set `FORWARDER` to override the constructor; `FORWARDER_KIND=mock` (the default) keeps the broadcast path. `FORWARDER_KIND=production` does not.
2. `forge create src/LegalNotary.sol:LegalNotary --broadcast --constructor-args <that forwarder>`.
3. `cast call <notary> "forwarder()(address)"` must match. Then it writes `evms[0].notaryAddress` in `cre/notary/config.staging.json`.
4. `cd cre && cre -e ../.env workflow simulate notary --non-interactive --trigger-index 0 --http-payload ../samples/saas-de.json -T local-simulation --broadcast`.
5. Exit 0 only when the tx hash is 32 non-zero bytes, `cast receipt` status is success, a log is addressed to the notary, and `count()` is not 0.

Success writes `deployments/base-sepolia.json` with `attestationOk: true` and `runs/broadcast-<utc>.log`. Only then should the README status change from "not executed" to deployed and broadcast. Paste that tx hash; do not invent one.

`--skip-broadcast` deploys and updates the config, then stops. That is still not an attestation.

`FORWARDER_KIND=production` deploys against KeystoneForwarder and refuses `--broadcast`, because the simulator would call the mock forwarder and `LegalNotary` would revert `NotForwarder`. Leave `expectedWorkflowId` at zero for a simulation broadcast. The mock forwarder does not provide workflow metadata, so a lock set beforehand makes `onReport` revert.

`CRE_MODE=broadcast` on the x402 gateway calls the same simulate command. It does not deploy, and it now errors if `notaryAddress` is still zero or the returned tx is `0x0`.
