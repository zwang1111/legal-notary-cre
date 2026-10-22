// Executes the CRE workflow for a paid request.
//   CRE_MODE=simulate : real `cre workflow simulate` (needs `cre login` or CRE_API_KEY). Dry run, tx 0x0.
//   CRE_MODE=broadcast: same command plus `--broadcast`. Requires a deployed notaryAddress and a funded key.
//   CRE_MODE=harness  : local stand-in that runs the SAME logic.ts with real GLEIF HTTP calls, encodes the same
//                       report payload, but performs NO onchain write. Clearly labelled; used when not logged in.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/** A broadcast is real only when CRE returns a 32-byte hash that is not all zeros. */
export function nonzeroBroadcastTx(tx: unknown): string | undefined {
  if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx) || /^0x0{64}$/i.test(tx)) return undefined;
  return tx;
}

/** simulate --broadcast reverts inside LegalNotary when notaryAddress is still unset. */
export function assertDeployedNotary(address: unknown): string {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
    throw new Error("notaryAddress is unset. Run scripts/deploy-base-sepolia.sh before broadcasting.");
  }
  return address;
}

export function runSimulate(req: NotaryRequest, broadcast = false): Promise<RunResult> {
  if (broadcast) {
    const cfg = JSON.parse(readFileSync(new URL("../../cre/notary/config.staging.json", import.meta.url), "utf8"));
    assertDeployedNotary(cfg?.evms?.[0]?.notaryAddress);
  }
  const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
  const args = existsSync(envFile) ? ["-e", envFile] : [];
  args.push("workflow", "simulate", "notary", "--non-interactive", "--trigger-index", "0", "--http-payload", JSON.stringify(req), "-T", "local-simulation");
  if (broadcast) args.push("--broadcast");
  return new Promise((res, rej) => {
    const p = spawn(process.env.CRE_BIN ?? "cre", args, { cwd: CRE_DIR, env: process.env });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      const logs = out.split("\n").filter((l) => /\[\d\]|verdict|Workflow|✓|✗|error/i.test(l));
      const m = out.match(/\{\\?"verdict\\?":.*?\}/);
      let r: any = {}; try { r = JSON.parse(m ? m[0].replace(/\\"/g, '"') : "{}"); } catch {}
      if (code !== 0) { rej(new Error(`cre simulate exited ${code}: ${out.slice(-600)}`)); return; }
      if (broadcast) {
        const tx = nonzeroBroadcastTx(r.tx);
        if (!tx) { rej(new Error(`broadcast did not produce a transaction hash: ${out.slice(-800)}`)); return; }
        res({ mode: "simulate+broadcast", ...r, tx, logs });
        return;
      }
      res({ mode: "simulate", ...r, logs });
    });
  });
}
