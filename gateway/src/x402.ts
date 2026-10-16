// Minimal x402 v1 "exact" (EIP-3009 transferWithAuthorization) for Base Sepolia USDC.
// Adapted from /workspace/climate-x402 (which uses the @x402/* SDK on Celo). Hand-rolled here so the
// demo runs fully offline: by default the gateway VERIFIES the signed authorization locally and does
// not settle (no funds move). Set FACILITATOR_URL (e.g. https://x402.org/facilitator) to verify+settle
// through a real facilitator on Base Sepolia testnet.
import { getAddress, verifyTypedData, type Account, toHex } from "viem";

export const NETWORK = "base-sepolia";
export const CHAIN_ID = 84532;
export const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e"); // Circle USDC, Base Sepolia
export const DOMAIN = { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC } as const;
export const TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] } as const;

export type Requirements = { scheme: "exact"; network: string; maxAmountRequired: string; resource: string; description: string;
  mimeType: string; payTo: string; maxTimeoutSeconds: number; asset: string; extra: { name: string; version: string } };
export const requirements = (o: { price: bigint; payTo: string; resource: string; description: string }): Requirements => ({
  scheme: "exact", network: NETWORK, maxAmountRequired: o.price.toString(), resource: o.resource, description: o.description,
  mimeType: "application/json", payTo: getAddress(o.payTo), maxTimeoutSeconds: 120, asset: USDC, extra: { name: "USDC", version: "2" } });

export const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64");
export const dec = (s: string) => JSON.parse(Buffer.from(s, "base64").toString());

/** Client side: build the X-PAYMENT header for a 402 challenge. */
export async function pay(account: Account, req: Requirements, now = Math.floor(Date.now() / 1000)) {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const authorization = { from: account.address, to: getAddress(req.payTo), value: req.maxAmountRequired,
    validAfter: String(now - 5), validBefore: String(now + req.maxTimeoutSeconds), nonce };
  const signature = await account.signTypedData!({ domain: DOMAIN, types: TYPES, primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) } as any });
  return enc({ x402Version: 1, scheme: "exact", network: NETWORK, payload: { signature, authorization } });
}

/** Server side: local verification of an X-PAYMENT header against requirements. */
export async function verifyLocal(header: string, req: Requirements, used: Set<string>, now = Math.floor(Date.now() / 1000)) {
  let p: any; try { p = dec(header); } catch { return { ok: false as const, reason: "malformed X-PAYMENT" }; }
  const a = p?.payload?.authorization, sig = p?.payload?.signature;
  if (p?.scheme !== "exact" || p?.network !== NETWORK || !a || !sig) return { ok: false as const, reason: "wrong scheme/network" };
  if (getAddress(a.to) !== getAddress(req.payTo)) return { ok: false as const, reason: "wrong payTo" };
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) return { ok: false as const, reason: "underpaid" };
  if (Number(a.validAfter) > now || Number(a.validBefore) < now) return { ok: false as const, reason: "expired" };
  if (used.has(a.nonce)) return { ok: false as const, reason: "nonce replay" };
  const valid = await verifyTypedData({ address: a.from, domain: DOMAIN, types: TYPES, primaryType: "TransferWithAuthorization",
    message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }, signature: sig }).catch(() => false);
  if (!valid) return { ok: false as const, reason: "bad signature" };
  used.add(a.nonce);
  return { ok: true as const, payer: getAddress(a.from) as string, nonce: a.nonce as string, payload: p };
}

/** Optional: real facilitator verify + settle (Base Sepolia testnet). */
export async function settleViaFacilitator(url: string, payload: unknown, req: Requirements) {
  const body = JSON.stringify({ x402Version: 1, paymentPayload: payload, paymentRequirements: req });
  const h = { "content-type": "application/json" };
  const v = await (await fetch(`${url}/verify`, { method: "POST", headers: h, body })).json();
  if (!v.isValid) throw new Error(`facilitator verify failed: ${v.invalidReason}`);
  return await (await fetch(`${url}/settle`, { method: "POST", headers: h, body })).json() as { success: boolean; transaction?: string; errorReason?: string };
}
