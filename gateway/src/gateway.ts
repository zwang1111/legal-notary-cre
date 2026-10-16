// x402 gateway in front of the CRE "legal-notary" workflow (pattern of smartcontractkit/cre_x402_smartcon_demo
// and x402-cre-price-alerts): POST /notarize -> 402 challenge -> paid retry -> CRE workflow -> attestation.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { requirements, verifyLocal, settleViaFacilitator, enc } from "./x402.ts";
import { runHarness, runSimulate, type RunResult } from "./runner.ts";
import type { NotaryRequest } from "../../cre/notary/logic.ts";

export function buildGateway(o: { price: bigint; payTo: string; mode: string; facilitator?: string; exec?: (r: NotaryRequest) => Promise<RunResult> }) {
  const app = new Hono(); const used = new Set<string>(); const ledger: any[] = [];
  const exec = o.exec ?? ((r: NotaryRequest) => (o.mode === "harness" ? runHarness(r) : runSimulate(r, o.mode === "broadcast")));
  app.get("/health", (c) => c.json({ ok: true, mode: o.mode, price: o.price.toString(), payTo: o.payTo }));
  app.get("/ledger", (c) => c.json(ledger));
  app.post("/notarize", async (c) => {
    const req = requirements({ price: o.price, payTo: o.payTo, resource: new URL(c.req.url).toString(),
      description: "CRE legal-notary: GLEIF party KYB + clause compliance + onchain attestation" });
    const h = c.req.header("x-payment");
    if (!h) return c.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [req] }, 402);
    const v = await verifyLocal(h, req, used);
    if (!v.ok) return c.json({ x402Version: 1, error: v.reason, accepts: [req] }, 402);
    let body: NotaryRequest; try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
    let settlement: any = { success: true, mode: "verified-locally (no settlement, no funds moved)" };
    if (o.facilitator) settlement = await settleViaFacilitator(o.facilitator, v.payload, req).catch((e) => ({ success: false, errorReason: String(e) }));
    if (!settlement.success) return c.json({ x402Version: 1, error: settlement.errorReason, accepts: [req] }, 402);
    const result = await exec({ ...body, payer: v.payer, paymentRef: settlement.transaction ?? v.nonce });
    ledger.push({ t: new Date().toISOString(), payer: v.payer, amount: o.price.toString(), docId: body.docId, verdict: result.verdict, settlement });
    c.header("X-PAYMENT-RESPONSE", enc({ success: true, network: req.network, payer: v.payer, transaction: settlement.transaction ?? "" }));
    return c.json(result);
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8402);
  const app = buildGateway({ price: BigInt(process.env.PRICE ?? "10000"), payTo: process.env.PAY_TO ?? "0x000000000000000000000000000000000000dEaD",
    mode: process.env.CRE_MODE ?? "harness", facilitator: process.env.FACILITATOR_URL });
  serve({ fetch: app.fetch, port }, () => console.log(`legal-cre x402 gateway :${port} mode=${process.env.CRE_MODE ?? "harness"} facilitator=${process.env.FACILITATOR_URL ?? "local-verify"}`));
}
