#!/usr/bin/env python3
"""Render a silent captioned demo video from slides + the real demo console output. Usage: scripts/render-video.py [out.mp4]"""
import os, subprocess, sys, textwrap
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1] if len(sys.argv) > 1 else "/workspace/legal-cre-demo.mp4"
W, H = 1920, 1080; D = "video-build"; os.makedirs(D, exist_ok=True)
F = "/usr/share/fonts/truetype/dejavu/"
big, mid, small, mono = (ImageFont.truetype(F + n, s) for n, s in [("DejaVuSans-Bold.ttf", 72), ("DejaVuSans.ttf", 40), ("DejaVuSans.ttf", 33), ("DejaVuSansMono.ttf", 25)])
con = [l.rstrip("\n")[:118] for l in open("runs/demo-console.txt")]
sim = [l.rstrip("\n").replace("2026-10-16T", "")[:118] for l in open("runs/cre-simulate-20261016.log") if ("[USER LOG]" in l or "✓" in l or "Binary hash" in l) and "limits" not in l]
def grab(start, end):
    i = next(k for k, l in enumerate(con) if start in l); j = next(k for k, l in enumerate(con) if end in l and k > i)
    return con[i:j + 1]
def slide(name, title, lines=(), caption="", code=False, bg=(14, 24, 52)):
    im = Image.new("RGB", (W, H), bg); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 10], fill=(55, 91, 210)); d.text((80, 50), title, font=big, fill="white"); y = 170
    for l in lines:
        col = (150, 255, 170) if "✓" in l or "PASS" in l else (255, 140, 140) if "✗" in l or "FAIL" in l else (225, 230, 240)
        d.text((90, y), l, font=mono if code else mid, fill=col if code else (225, 230, 240)); y += 33 if code else 60
    d.rectangle([0, H - 150, W, H], fill=(0, 0, 0))
    for i, c in enumerate(textwrap.wrap(caption, 95)[:3]): d.text((80, H - 135 + i * 42), c, font=small, fill=(255, 230, 120))
    p = f"{D}/{name}.png"; im.save(p); return p
S = [
 (slide("01", "Legal Notary on Chainlink CRE", ["AI agents pay per call (x402) for verifiable contract checks", "", "BLI Legal Tech Hackathon 2  ·  Chainlink 'Best workflow with CRE'", "", "GLEIF KYB  +  clause compliance  +  onchain attestation", "CRE TypeScript workflow  ·  Base Sepolia  ·  USDC x402"],
   "Legal Notary: a Chainlink CRE workflow that AI agents pay for, per call, with x402 to verify a contract and notarize the result onchain."), 18),
 (slide("02", "The problem", ["• AI paralegals now draft, review and route contracts", "• Counterparty KYB is manual: who is this legal entity?", "• Compliance checks live in private tools: no audit trail", "• APIs need accounts + API keys: unusable by autonomous agents", "• 'Did anyone check this before signing?' is unprovable"],
   "Agents are reviewing contracts, but entity verification and compliance checks are manual, private and impossible to prove afterwards."), 24),
 (slide("03", "Architecture", ["Paralegal agent ──POST /notarize──▶ x402 gateway  (402: 0.01 USDC)", "      └─ signs EIP-3009 authorization ─▶ X-PAYMENT ─▶ verified", "x402 gateway ──HTTP trigger──▶ CRE workflow 'legal-notary'", "   1. HTTP capability: GLEIF LEI lookup per party (DON consensus)", "   2. deterministic clause checklist per jurisdiction (GDPR for EU)", "   3. signed CRE report ─▶ EVM write ─▶ LegalNotary.sol (Base Sepolia)", "Agent acts on verdict: PASS file · REVIEW lawyer · FAIL block"],
   "Same pattern as Chainlink's official x402 + CRE examples: an x402-protected endpoint triggers the workflow, which joins an external API with an onchain write."), 30),
 (slide("04", "Build + test", grab("== 1.", "== 3.") + grab("Workflow compiled", "Binary hash"), "7 TypeScript tests (logic, x402, end-to-end), 4 Foundry tests for the receiver contract, and the workflow compiles to WASM with the CRE CLI.", code=True, bg=(12, 12, 16)), 22),
 (slide("05", "Agent pays, CRE verifies: PASS", grab("agent start", "decision {'docId': 'MSA")[:24], "A German SaaS agreement: both LEIs active in GLEIF, all clauses incl. GDPR Art. 28 present → PASS 100, doc hash ready for onchain attestation.", code=True, bg=(12, 12, 16)), 32),
 (slide("06", "Risky draft: FAIL", grab("plan {'docId': 'NDA-77'", "done")[:24], "A US vendor draft: one counterparty LEI fails the checksum, unlimited liability, no governing law, no signatures → FAIL. The agent blocks signing.", code=True, bg=(12, 12, 16)), 30),
 (slide("06b", "Real 'cre workflow simulate' (CRE CLI v1.38)", sim[:26], "The same workflow running in the real CRE simulator: live GLEIF lookups, clause checks, PASS 100. EVM write is a dry run (no --broadcast, contract not yet deployed).", code=True, bg=(12, 12, 16)), 28),
 (slide("07", "Honest status & next steps", ["• Agent flow shown via local harness; real 'cre workflow simulate' passes", "  (no onchain write; x402 authorization verified locally, no funds moved)", "• Full log: runs/cre-simulate-20261016.log", "  and --broadcast writes to LegalNotary on Base Sepolia", "• Next: deploy to CRE, LLM clause extraction, sanctions screening", "", "github: github.com/zwang1111/legal-notary-cre   ·   testnet only   ·   not legal advice"],
   "Everything is testnet-only. Next steps: live CRE deployment, LLM clause extraction with consensus, and sanctions lists."), 22),
]
with open(f"{D}/list.txt", "w") as f:
    for p, s in S: f.write(f"file '{os.path.basename(p)}'\nduration {s}\n")
    f.write(f"file '{os.path.basename(S[-1][0])}'\n")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{D}/list.txt", "-vf", "fps=25,format=yuv420p", "-c:v", "libx264", OUT], check=True)
print("wrote", OUT)
