#!/usr/bin/env python3
"""Config and tx-hash helpers for scripts/deploy-base-sepolia.sh.

No network calls. Refuses the all-zero hashes that `cre workflow simulate` prints
on a dry run, so a log cannot be mistaken for an attestation.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORWARDERS = ROOT / "cre" / "notary" / "forwarders.json"
TX_RE = re.compile(r'tx\\?"?\s*:\s*\\?"?(0x[0-9a-fA-F]{64})')
ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
NOTARY_RE = re.compile(r'("notaryAddress"\s*:\s*")0x[0-9a-fA-F]{40}(")')


def is_address(value: object) -> bool:
    return isinstance(value, str) and ADDR_RE.match(value) is not None


def is_zero_address(value: object) -> bool:
    return isinstance(value, str) and value.lower() == "0x" + "0" * 40


def is_nonzero_tx(value: object) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        return False
    return int(value, 16) != 0


def load_forwarders() -> dict:
    return json.loads(FORWARDERS.read_text())


def mock_forwarder_from_supported_chains(rows: object, chain_name: str) -> str:
    """Pick MockKeystoneForwarder for simulate --broadcast.

    CRE CLI v1.39 JSON rows have both fields:
      address      production KeystoneForwarder (NotForwarder if used with --broadcast)
      mockAddress  MockKeystoneForwarder
    Never fall back to address. An empty result means the caller should keep its pin.
    """
    if isinstance(rows, dict):
        rows = rows.get("chains") or rows.get("rows") or []
    if not isinstance(rows, list):
        return ""
    for row in rows:
        if not isinstance(row, dict) or row.get("chainName") != chain_name:
            continue
        mock = row.get("mockAddress") or ""
        if is_address(mock) and not is_zero_address(mock):
            return mock
        return ""
    return ""


def read_notary_address(text: str) -> str:
    match = NOTARY_RE.search(text)
    if not match:
        raise SystemExit("config has no notaryAddress")
    return match.group(0).split('"')[3]


def set_notary_address(text: str, address: str) -> str:
    if not is_address(address) or is_zero_address(address):
        raise SystemExit(f"refusing to write notaryAddress {address!r}")
    updated, count = NOTARY_RE.subn(rf"\g<1>{address}\2", text, count=1)
    if count != 1:
        raise SystemExit("config has no notaryAddress")
    return updated


def parse_forge_create(text: str) -> dict:
    deployed = re.search(r"^Deployed to:\s*(0x[0-9a-fA-F]{40})\s*$", text, re.M)
    tx = re.search(r"^Transaction hash:\s*(0x[0-9a-fA-F]{64})\s*$", text, re.M)
    deployer = re.search(r"^Deployer:\s*(0x[0-9a-fA-F]{40})\s*$", text, re.M)
    if not deployed or not tx:
        raise SystemExit("forge create output has no Deployed to / Transaction hash")
    if not is_nonzero_tx(tx.group(1)):
        raise SystemExit("forge create returned a zero transaction hash; not recording it")
    return {
        "address": deployed.group(1),
        "deployTx": tx.group(1),
        "deployer": deployer.group(1) if deployer else "",
    }


def extract_tx(text: str) -> str:
    found = TX_RE.findall(text)
    if not found:
        raise SystemExit("CRE output has no tx field")
    return found[-1]


def receipt_attests(receipt: dict, notary: str) -> bool:
    status = receipt.get("status")
    if isinstance(status, str) and status.startswith("0x"):
        ok = int(status, 16) == 1
    else:
        ok = status in (1, "1", True)
    notary_l = notary.lower()
    logs = receipt.get("logs") or []
    hit = any(str(log.get("address", "")).lower() == notary_l for log in logs)
    return bool(ok and hit)


def write_deployment(path: Path, record: dict) -> None:
    tx = record.get("attestationTx")
    if tx is not None and not is_nonzero_tx(tx):
        raise SystemExit("refusing to record an empty attestation tx")
    if not is_address(record.get("address")) or is_zero_address(record.get("address")):
        raise SystemExit("refusing to record a zero notary address")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2) + "\n")


def self_test() -> None:
    pins = load_forwarders()
    assert pins["chainId"] == 84532
    assert is_address(pins["mockKeystoneForwarder"])
    assert is_address(pins["keystoneForwarder"])
    assert pins["mockKeystoneForwarder"].lower() != pins["keystoneForwarder"].lower()

    chain = pins["chainSelectorName"]
    rows = [{
        "chainName": chain,
        "chainSelector": 10344971235874465080,
        "address": pins["keystoneForwarder"],
        "mockAddress": pins["mockKeystoneForwarder"],
    }]
    picked = mock_forwarder_from_supported_chains(rows, chain)
    assert picked.lower() == pins["mockKeystoneForwarder"].lower()
    assert picked.lower() != pins["keystoneForwarder"].lower()
    # Production `address` must not be used when mockAddress is missing.
    assert mock_forwarder_from_supported_chains(
        [{"chainName": chain, "address": pins["keystoneForwarder"]}], chain
    ) == ""
    assert mock_forwarder_from_supported_chains(
        [{"chainName": chain, "address": pins["keystoneForwarder"], "mockAddress": "0x" + "0" * 40}],
        chain,
    ) == ""

    zero = "0x" + "0" * 64
    real = "0x" + "ab" * 32
    assert not is_nonzero_tx(zero)
    assert not is_nonzero_tx("0x0")
    assert is_nonzero_tx(real)

    forged = (
        "Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\n"
        "Deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3\n"
        "Transaction hash: 0xab34fceab3438f521bae34ca652c704e43991ac10b6a6483e57b48ee9d7cee58\n"
    )
    parsed = parse_forge_create(forged)
    assert parsed["address"].lower() == "0x5fbdb2315678afecb367f032d93f642f64180aa3"

    cfg = (ROOT / "cre" / "notary" / "config.staging.json").read_text()
    assert is_zero_address(read_notary_address(cfg))
    updated = set_notary_address(cfg, pins["mockKeystoneForwarder"])
    assert read_notary_address(updated).lower() == pins["mockKeystoneForwarder"].lower()
    assert is_zero_address(read_notary_address(cfg))
    try:
        set_notary_address(cfg, "0x" + "0" * 40)
        raise AssertionError("zero address was accepted")
    except SystemExit:
        pass

    log = (ROOT / "runs" / "cre-simulate-20261016.log").read_text()
    assert not is_nonzero_tx(extract_tx(log))
    escaped = '"{\\"verdict\\":\\"PASS\\",\\"tx\\":\\"%s\\"}"' % real
    assert extract_tx(escaped) == real
    plain = '{"verdict":"PASS","tx":"%s"}' % real
    assert extract_tx(plain) == real

    assert receipt_attests(
        {"status": "0x1", "logs": [{"address": pins["mockKeystoneForwarder"]}]},
        pins["mockKeystoneForwarder"],
    )
    assert not receipt_attests({"status": "0x1", "logs": []}, pins["mockKeystoneForwarder"])
    assert not receipt_attests(
        {"status": "0x0", "logs": [{"address": pins["mockKeystoneForwarder"]}]},
        pins["mockKeystoneForwarder"],
    )
    print("notary_config self-test ok")


def main(argv: list[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "self-test"
    if cmd == "self-test":
        self_test()
    elif cmd == "show-forwarders":
        print(json.dumps(load_forwarders()))
    elif cmd == "mock-from-chains":
        print(mock_forwarder_from_supported_chains(json.loads(sys.stdin.read()), argv[2]))
    elif cmd == "read-address":
        print(read_notary_address(Path(argv[2]).read_text()))
    elif cmd == "set-address":
        path = Path(argv[2])
        path.write_text(set_notary_address(path.read_text(), argv[3]))
        print(argv[3])
    elif cmd == "parse-forge":
        print(json.dumps(parse_forge_create(sys.stdin.read())))
    elif cmd == "extract-tx":
        tx = extract_tx(sys.stdin.read())
        if not is_nonzero_tx(tx):
            raise SystemExit(f"dry-run or empty tx: {tx}")
        print(tx)
    elif cmd == "assert-receipt":
        receipt = json.loads(Path(argv[2]).read_text())
        if not receipt_attests(receipt, argv[3]):
            raise SystemExit("receipt is not a successful LegalNotary log")
        print("ok")
    elif cmd == "write-deployment":
        write_deployment(Path(argv[2]), json.loads(sys.stdin.read()))
    else:
        raise SystemExit(f"unknown command {cmd}")


if __name__ == "__main__":
    main(sys.argv)
