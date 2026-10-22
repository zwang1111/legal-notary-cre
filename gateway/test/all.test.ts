import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { validLei, checkClauses, checkParty, decide, encodeAttestation } from "../../cre/notary/logic.ts";
import { requirements, pay, verifyLocal } from "../src/x402.ts";
import { buildGateway } from "../src/gateway.ts";
import { assertDeployedNotary, nonzeroBroadcastTx, runHarness } from "../src/runner.ts";
import { runAgent } from "../src/agent.ts";

const good = JSON.parse(readFileSync(new URL("../../samples/saas-de.json", import.meta.url), "utf8"));
const bad = JSON.parse(readFileSync(new URL("../../samples/risky-us.json", import.meta.url), "utf8"));
const gleif = (name: string, status = "ACTIVE", reg = "ISSUED") => ({ data: { attributes: { entity: { status, legalName: { name }, legalAddress: { country: "DE" } }, registration: { status: reg } } } });
const mockFetch = (async (url: string) => {
  const lei = String(url).split("/").pop();
  const db: any = { "7LTWFZYICNSX8D621K86": "DEUTSCHE BANK AKTIENGESELLSCHAFT", "5493001KJTIIGC8Y1R12": "Bloomberg Finance L.P." };
  return db[lei!] ? new Response(JSON.stringify(gleif(db[lei!]))) : new Response("{}", { status: 404 });
}) as typeof fetch;
const PAYTO = "0x000000000000000000000000000000000000dEaD";

test("LEI checksum (ISO 17442)", () => {
  assert.ok(validLei("7LTWFZYICNSX8D621K86")); assert.ok(validLei("5493001KJTIIGC8Y1R12"));
  assert.ok(!validLei("529900T8BM49AURSDO99")); assert.ok(!validLei("short"));
});
test("clause checklist: EU contract passes incl. GDPR, US draft fails", () => {
  assert.ok(checkClauses(good.text, "DE").every((f) => f.ok));
  const b = checkClauses(bad.text, "US");
  for (const id of ["governing-law", "signatures", "no-unlimited-liability", "liability-cap"]) assert.equal(b.find((f) => f.id === id)!.ok, false, id);
  assert.equal(checkClauses("governed by", "FR").find((f) => f.id === "gdpr-dpa")!.ok, false);
});
test("GLEIF party check: active+match ok, lapsed / mismatch / missing fail", () => {
  assert.ok(checkParty("7LTWFZYICNSX8D621K86", "Deutsche Bank Aktiengesellschaft", gleif("DEUTSCHE BANK AKTIENGESELLSCHAFT")).ok);
  assert.ok(!checkParty("7LTWFZYICNSX8D621K86", "Deutsche Bank", gleif("DEUTSCHE BANK AG", "INACTIVE")).ok);
  assert.ok(!checkParty("7LTWFZYICNSX8D621K86", "Acme", gleif("DEUTSCHE BANK AG")).ok);
  assert.ok(!checkParty("7LTWFZYICNSX8D621K86", "X", null).ok);
});
test("verdicts + ABI payload matches LegalNotary decoding", () => {
  const ok = decide(good, good.parties.map((p: any) => ({ ...p, ok: true, note: "" })));
  assert.equal(ok.verdict, "PASS"); assert.equal(ok.score, 100);
  const no = decide(bad, [{ lei: "x", name: "y", ok: false, note: "" }]); assert.equal(no.verdict, "FAIL");
  const [docHash, verdict, score, , , j, payer] = decodeAbiParameters(parseAbiParameters("bytes32, uint8, uint8, bytes32, bytes32, string, address"), encodeAttestation({ ...good, payer: PAYTO }, ok));
  assert.equal(docHash, ok.docHash); assert.equal(verdict, 1); assert.equal(score, 100); assert.equal(j, "DE"); assert.equal(payer, PAYTO);
});
test("x402 exact: valid authorization verifies; replay, underpay, wrong payTo rejected", async () => {
  const a = privateKeyToAccount(generatePrivateKey()); const used = new Set<string>();
  const req = requirements({ price: 10000n, payTo: PAYTO, resource: "http://x/notarize", description: "d" });
  const h = await pay(a, req);
  const v = await verifyLocal(h, req, used); assert.ok(v.ok); assert.equal((v as any).payer, a.address);
  assert.equal((await verifyLocal(h, req, used) as any).reason, "nonce replay");
  assert.equal((await verifyLocal(await pay(a, { ...req, maxAmountRequired: "1" }), req, used) as any).reason, "underpaid");
  assert.equal((await verifyLocal(await pay(a, { ...req, payTo: "0x00000000000000000000000000000000000000A1" }), req, used) as any).reason, "wrong payTo");
});
test("broadcast rejects a dry-run tx and an undeployed notary", () => {
  const zero = "0x" + "00".repeat(32);
  const real = "0x" + "ab".repeat(32);
  assert.equal(nonzeroBroadcastTx(zero), undefined);
  assert.equal(nonzeroBroadcastTx("0x0"), undefined);
  assert.equal(nonzeroBroadcastTx(real), real);
  assert.throws(() => assertDeployedNotary("0x" + "00".repeat(20)), /deploy-base-sepolia/);
  assert.equal(assertDeployedNotary("0x" + "11".repeat(20)), "0x" + "11".repeat(20));
});
test("harness runs workflow logic with GLEIF responses", async () => {
  const r = await runHarness(good, mockFetch); assert.equal(r.verdict, "PASS");
  const r2 = await runHarness(bad, mockFetch); assert.equal(r2.verdict, "FAIL");
});
test("gateway + agent end-to-end: 402 -> pay -> CRE -> decision, spend policy enforced", async () => {
  const app = buildGateway({ price: 10000n, payTo: PAYTO, mode: "harness", exec: (r) => runHarness(r, mockFetch) });
  const { serve } = await import("@hono/node-server");
  const srv = serve({ fetch: app.fetch, port: 18402 });
  try {
    const r = await fetch("http://127.0.0.1:18402/notarize", { method: "POST", body: "{}" }); assert.equal(r.status, 402);
    const logs: any[] = [];
    const res = await runAgent({ base: "http://127.0.0.1:18402", pk: generatePrivateKey(), docs: [good, bad], maxPerCall: 50000n, budget: 15000n, log: (e) => logs.push(e) });
    assert.equal(res.length, 1); assert.equal(res[0].verdict, "PASS");
    assert.ok(logs.some((e) => e.step === "refuse: over spend policy"));
    const ledger = await (await fetch("http://127.0.0.1:18402/ledger")).json(); assert.equal(ledger.length, 1);
  } finally { srv.close(); }
});
