// CRE workflow "legal-notary": an AI agent pays per call via x402; the x402 gateway forwards the
// paid request to this workflow's HTTP trigger. The workflow
//   1. verifies every contracting party's LEI against the GLEIF API (HTTP capability, DON consensus),
//   2. runs a deterministic clause-compliance checklist for the contract's jurisdiction,
//   3. signs a CRE report and writes the attestation (doc hash, verdict, score, payer) to the
//      LegalNotary receiver on Base Sepolia (EVM write capability).
import {
  cre, Runner, type Runtime, type HTTPPayload, type HTTPSendRequester,
  getNetwork, hexToBase64, bytesToHex, TxStatus, decodeJson, ok, consensusIdenticalAggregation,
} from "@chainlink/cre-sdk";
import { checkParty, decide, encodeAttestation, type NotaryRequest } from "./logic";

type Config = { publicKey: string; gleifBase: string; evms: { notaryAddress: string; chainSelectorName: string; gasLimit: string }[] };
type Lei = { found: boolean; status: string; reg: string; legalName: string; country: string };

const fetchLei = (lei: string) => (s: HTTPSendRequester, config: Config): Lei => {
  const resp = s.sendRequest({ url: `${config.gleifBase}/lei-records/${lei}`, method: "GET" as const,
    headers: { Accept: "application/vnd.api+json" }, cacheSettings: { store: true, maxAge: "300s" } }).result();
  if (!ok(resp)) return { found: false, status: "", reg: "", legalName: "", country: "" };
  const a = JSON.parse(new TextDecoder().decode(resp.body))?.data?.attributes ?? {};
  // Reduce to the fields we use so every node returns byte-identical results for consensus.
  return { found: true, status: a.entity?.status ?? "", reg: a.registration?.status ?? "", legalName: a.entity?.legalName?.name ?? "", country: a.entity?.legalAddress?.country ?? "" };
};

const onNotarize = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const req = decodeJson(payload.input) as NotaryRequest;
  if (!req?.text || !req?.jurisdiction || !Array.isArray(req.parties)) throw new Error("invalid notary request");
  runtime.log(`[1] notarize "${req.title}" (${req.jurisdiction}), ${req.parties.length} parties, payer ${req.payer}, x402 ref ${req.paymentRef}`);

  const http = new cre.capabilities.HTTPClient();
  const parties = req.parties.map((p) => {
    const r = http.sendRequest(runtime, fetchLei(p.lei), consensusIdenticalAggregation<Lei>())(runtime.config).result();
    const gleif = r.found ? { data: { attributes: { entity: { status: r.status, legalName: { name: r.legalName }, legalAddress: { country: r.country } }, registration: { status: r.reg } } } } : null;
    const c = checkParty(p.lei, p.name, gleif);
    runtime.log(`[2] GLEIF ${p.lei}: ${c.ok ? "OK" : "FAIL"} ${c.note}`);
    return c;
  });

  const v = decide(req, parties);
  for (const f of v.findings) runtime.log(`[3] ${f.ok ? "✓" : "✗"} ${f.id} (${f.severity}) ${f.note}`);
  runtime.log(`[3] verdict ${v.verdict}, score ${v.score}, docHash ${v.docHash}`);

  const evm = runtime.config.evms[0];
  const net = getNetwork({ chainFamily: "evm", chainSelectorName: evm.chainSelectorName, isTestnet: true });
  if (!net) throw new Error(`unknown chain ${evm.chainSelectorName}`);
  const report = runtime.report({ encodedPayload: hexToBase64(encodeAttestation(req, v)), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" }).result();
  const w = new cre.capabilities.EVMClient(net.chainSelector.selector)
    .writeReport(runtime, { receiver: evm.notaryAddress, report, gasConfig: { gasLimit: evm.gasLimit } }).result();
  if (w.txStatus !== TxStatus.SUCCESS) throw new Error(`write failed: ${w.txStatus}`);
  const tx = bytesToHex(w.txHash || new Uint8Array(32));
  runtime.log(`[4] attestation written to LegalNotary ${evm.notaryAddress}: ${tx}`);
  return JSON.stringify({ verdict: v.verdict, score: v.score, docHash: v.docHash, tx });
};

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability();
  // In simulation authorizedKeys may be empty; for deployment set publicKey to the x402 gateway's signer address.
  return [cre.handler(http.trigger({ authorizedKeys: config.publicKey ? [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: config.publicKey }] : [] }), onNotarize)];
};

export async function main() { const runner = await Runner.newRunner<Config>(); await runner.run(initWorkflow); }
main();
