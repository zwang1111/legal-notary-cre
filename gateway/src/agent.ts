// "Paralegal" AI agent: given a folder of contracts, it decides which need notarization, enforces a spend
// policy (per-call cap + total budget), pays per call via x402 and acts on the CRE verdict.
// The planner is rule-based by default (deterministic for the demo); swap in an LLM via planWithLLM if wanted.
import { readFileSync, readdirSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { pay } from "./x402.ts";

export type Log = (e: Record<string, unknown>) => void;
export async function runAgent(o: { base: string; pk: `0x${string}`; docs: any[]; maxPerCall: bigint; budget: bigint; log: Log }) {
  const acct = privateKeyToAccount(o.pk); let spent = 0n; const out: any[] = [];
  o.log({ step: "agent start", agent: acct.address, budget: o.budget.toString(), maxPerCall: o.maxPerCall.toString() });
  for (const doc of o.docs) {
    o.log({ step: "plan", docId: doc.docId, action: "request CRE notarization (KYB + compliance + attestation)" });
    const r1 = await fetch(`${o.base}/notarize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
    if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}`);
    const req = (await r1.json()).accepts[0];
    o.log({ step: "402 challenge", docId: doc.docId, amount: req.maxAmountRequired, asset: req.asset, network: req.network, payTo: req.payTo });
    const amt = BigInt(req.maxAmountRequired);
    if (amt > o.maxPerCall || spent + amt > o.budget) { o.log({ step: "refuse: over spend policy", docId: doc.docId }); continue; }
    const r2 = await fetch(`${o.base}/notarize`, { method: "POST", headers: { "content-type": "application/json", "x-payment": await pay(acct, req) }, body: JSON.stringify(doc) });
    const j: any = await r2.json(); spent += r2.ok ? amt : 0n;
    const settle = r2.headers.get("x-payment-response");
    o.log({ step: "paid + CRE result", docId: doc.docId, status: r2.status, mode: j.mode, verdict: j.verdict, score: j.score, docHash: j.docHash, tx: j.tx, logs: j.logs, settle: settle ? JSON.parse(Buffer.from(settle, "base64").toString()) : undefined });
    const action = j.verdict === "PASS" ? "file as executed; share attestation hash with counterparty"
      : j.verdict === "REVIEW" ? "route to human lawyer with failed checks" : "block signing; notify counterparty of failed KYB/clauses";
    o.log({ step: "decision", docId: doc.docId, action }); out.push(j);
  }
  o.log({ step: "done", spent: spent.toString(), calls: out.length });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL("../../samples/", import.meta.url);
  const docs = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse().map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
  // Throwaway key by default: in local-verify mode no funds are needed. Use a funded Base Sepolia key only with FACILITATOR_URL.
  await runAgent({ base: process.env.API_BASE ?? "http://127.0.0.1:8402", pk: (process.env.AGENT_PK ?? generatePrivateKey()) as `0x${string}`, docs,
    maxPerCall: BigInt(process.env.MAX_PER_CALL ?? "50000"), budget: BigInt(process.env.BUDGET ?? "100000"), log: (e) => console.log(JSON.stringify(e)) });
}
