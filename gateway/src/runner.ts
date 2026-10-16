// Executes the CRE workflow for a paid request.
//   CRE_MODE=simulate : real `cre workflow simulate` (needs `cre login` or CRE_API_KEY) - the bounty proof.
//   CRE_MODE=harness  : local stand-in that runs the SAME logic.ts with real GLEIF HTTP calls, encodes the same
//                       report payload, but performs NO onchain write. Clearly labelled; used when not logged in.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkParty, decide, encodeAttestation, type NotaryRequest } from "../../cre/notary/logic.ts";

const CRE_DIR = fileURLToPath(new URL("../../cre", import.meta.url));
export type RunResult = { mode: string; verdict?: string; score?: number; docHash?: string; tx?: string; report?: string; logs: string[]; detail?: unknown };

export async function runHarness(req: NotaryRequest, fetchFn: typeof fetch = fetch, gleif = "https://api.gleif.org/api/v1"): Promise<RunResult> {
  const logs: string[] = [];
  const parties = [];
  for (const p of req.parties) {
    const r = await fetchFn(`${gleif}/lei-records/${p.lei}`, { headers: { Accept: "application/vnd.api+json" } });
    const c = checkParty(p.lei, p.name, r.ok ? await r.json() : null);
    logs.push(`[2] GLEIF ${p.lei}: ${c.ok ? "OK" : "FAIL"} ${c.note}`); parties.push(c);
  }
  const v = decide(req, parties);
  for (const f of v.findings) logs.push(`[3] ${f.ok ? "✓" : "✗"} ${f.id} (${f.severity}) ${f.note}`);
  const report = encodeAttestation(req, v);
  logs.push(`[3] verdict ${v.verdict}, score ${v.score}, docHash ${v.docHash}`, `[4] (harness) report payload ${report.slice(0, 42)}… not written onchain`);
  return { mode: "harness", verdict: v.verdict, score: v.score, docHash: v.docHash, report, logs, detail: v };
}

export function runSimulate(req: NotaryRequest, broadcast = false): Promise<RunResult> {
  const args = ["workflow", "simulate", "notary", "--non-interactive", "--trigger-index", "0", "--http-payload", JSON.stringify(req), "-T", "local-simulation"];
  if (broadcast) args.push("--broadcast");
  return new Promise((res, rej) => {
    const p = spawn(process.env.CRE_BIN ?? "cre", args, { cwd: CRE_DIR, env: process.env });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      const logs = out.split("\n").filter((l) => /\[\d\]|verdict|Workflow|✓|✗|error/i.test(l));
      const m = out.match(/\{\\?"verdict\\?":.*?\}/);
      let r: any = {}; try { r = JSON.parse(m ? m[0].replace(/\\"/g, '"') : "{}"); } catch {}
      code === 0 ? res({ mode: broadcast ? "simulate+broadcast" : "simulate", ...r, logs }) : rej(new Error(`cre simulate exited ${code}: ${out.slice(-600)}`));
    });
  });
}
