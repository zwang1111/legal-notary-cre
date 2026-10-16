// Pure, deterministic legal-check logic shared by the CRE workflow (cre/notary/main.ts)
// and by tests / the local harness. No I/O here, so every DON node computes the same result.
import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";

export type NotaryRequest = {
  docId: string;              // caller's reference
  title: string;
  jurisdiction: string;       // ISO country code, e.g. "DE", "US", "SG"
  text: string;               // full contract text (hashed, never stored onchain)
  parties: { name: string; lei: string }[];
  payer?: string;             // x402 payer address (from the gateway)
  paymentRef?: string;        // x402 authorization nonce / settlement tx
};

export type Finding = { id: string; ok: boolean; severity: "high" | "medium" | "low"; note: string };
export type PartyCheck = { lei: string; name: string; ok: boolean; status?: string; legalName?: string; country?: string; note: string };

const EU = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);

/** ISO 17442 LEI checksum (mod 97 == 1). */
export function validLei(lei: string): boolean {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) return false;
  const digits = lei.split("").map((c) => (/[A-Z]/.test(c) ? (c.charCodeAt(0) - 55).toString() : c)).join("");
  let r = 0; for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}

/** Clause-level compliance checklist. Deterministic regex rules, not legal advice. */
export function checkClauses(text: string, jurisdiction: string): Finding[] {
  const t = text.toLowerCase(), j = jurisdiction.toUpperCase();
  const has = (re: RegExp) => re.test(t);
  const f: Finding[] = [
    { id: "governing-law", ok: has(/governed by|governing law/), severity: "high", note: "Contract names a governing law" },
    { id: "dispute-resolution", ok: has(/arbitration|exclusive jurisdiction|courts of/), severity: "medium", note: "Dispute resolution forum defined" },
    { id: "liability-cap", ok: has(/limitation of liability|liability .{0,40}(shall not exceed|capped|limited to)/), severity: "medium", note: "Liability is capped" },
    { id: "termination", ok: has(/terminat/), severity: "medium", note: "Termination rights present" },
    { id: "confidentiality", ok: has(/confidential/), severity: "low", note: "Confidentiality clause present" },
    { id: "signatures", ok: has(/signed|signature|in witness whereof/), severity: "high", note: "Execution / signature block present" },
  ];
  if (EU.has(j)) f.push({ id: "gdpr-dpa", ok: has(/gdpr|regulation \(eu\) 2016\/679|data processing agreement|article 28/), severity: "high", note: "EU: GDPR Art. 28 data processing terms" });
  if (j === "US") f.push({ id: "us-state-law", ok: has(/state of [a-z]+/), severity: "low", note: "US: names the governing state" });
  const unlimited = has(/unlimited liability|without limit/);
  f.push({ id: "no-unlimited-liability", ok: !unlimited, severity: "high", note: unlimited ? "Contains unlimited liability language" : "No unlimited liability language" });
  return f;
}

/** Interpret one GLEIF API response (https://api.gleif.org/api/v1/lei-records/{lei}). */
export function checkParty(lei: string, name: string, gleif: any): PartyCheck {
  if (!validLei(lei)) return { lei, name, ok: false, note: "invalid LEI checksum" };
  const a = gleif?.data?.attributes;
  if (!a) return { lei, name, ok: false, note: "LEI not found in GLEIF" };
  const legalName: string = a.entity?.legalName?.name ?? "";
  const status: string = a.entity?.status ?? "";
  const reg: string = a.registration?.status ?? "";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameOk = norm(legalName).includes(norm(name)) || norm(name).includes(norm(legalName));
  const ok = status === "ACTIVE" && ["ISSUED", "PENDING_TRANSFER", "PENDING_ARCHIVAL"].includes(reg) && nameOk;
  return { lei, name, ok, status: `${status}/${reg}`, legalName, country: a.entity?.legalAddress?.country,
    note: ok ? "active LEI, name matches" : !nameOk ? `name mismatch (GLEIF: ${legalName})` : `entity ${status}, registration ${reg}` };
}

export type Verdict = { docHash: `0x${string}`; score: number; verdict: "PASS" | "REVIEW" | "FAIL"; findings: Finding[]; parties: PartyCheck[] };

export function decide(req: NotaryRequest, parties: PartyCheck[]): Verdict {
  const findings = checkClauses(req.text, req.jurisdiction);
  const w = { high: 3, medium: 2, low: 1 } as const;
  const total = findings.reduce((s, x) => s + w[x.severity], 0) + parties.length * 3;
  const got = findings.reduce((s, x) => s + (x.ok ? w[x.severity] : 0), 0) + parties.filter((p) => p.ok).length * 3;
  const score = Math.round((100 * got) / Math.max(total, 1));
  const highFail = findings.some((x) => !x.ok && x.severity === "high") || parties.some((p) => !p.ok);
  const verdict = highFail ? (score < 50 ? "FAIL" : "REVIEW") : score >= 85 ? "PASS" : "REVIEW";
  return { docHash: keccak256(toHex(req.text)), score, verdict, findings, parties };
}

const V = { PASS: 1, REVIEW: 2, FAIL: 3 } as const;
/** ABI payload written onchain by the CRE report: matches LegalNotary.onReport decoding. */
export function encodeAttestation(req: NotaryRequest, v: Verdict): `0x${string}` {
  const findingsHash = keccak256(toHex(JSON.stringify({ f: v.findings, p: v.parties })));
  const leis = keccak256(toHex(req.parties.map((p) => p.lei).sort().join(",")));
  return encodeAbiParameters(parseAbiParameters("bytes32 docHash, uint8 verdict, uint8 score, bytes32 findingsHash, bytes32 partiesHash, string jurisdiction, address payer"),
    [v.docHash, V[v.verdict], v.score, findingsHash, leis, req.jurisdiction.toUpperCase(), (req.payer ?? "0x0000000000000000000000000000000000000000") as `0x${string}`]);
}
