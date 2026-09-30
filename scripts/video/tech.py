import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
REC = os.environ.get("RECORDING", "recording")   # output of record-demo-captioned.mjs
OUT = os.environ.get("VIDEO_OUT", "video-out")
STILLS = os.environ.get("STILLS", f"{OUT}/stills")  # t1.png: the reverted receipt, t2.png: chancela-check
W = f"{OUT}/tech"; os.makedirs(W, exist_ok=True)
marks = json.load(open(f"{REC}/marks.json"))
src = sorted(glob.glob(f"{REC}/*.webm"))[-1]

# (from, to, narration, caption) -- or ("still", png, narration, caption)
SEG = [
 ("landing", "demo",
  "This is Chancela, live on Monad testnet. It gives AI agents limits they cannot talk their way past: a policy decides, Monad records, and the venue enforces.",
  "Chancela, live on Monad testnet: limits an AI agent cannot talk its way past.\nA policy decides, Monad records, the venue enforces."),
 ("demo", "identity",
  "One click opens the guided demo. No login, no wallet, and every step runs against the real system.",
  "One click, no login, no wallet.\nEvery step runs against the real system."),
 ("identity", "allow",
  "This is a trading agent with an E R C eighty-oh-four identity. Its policy allows orders up to five hundred dollars, and nothing else.",
  "A trading agent with an ERC-8004 identity.\nIts policy: orders up to $500, nothing else."),
 ("allow", "proof",
  "It asks to buy two hundred dollars of E T H. A real language model reads the request, but a deterministic policy engine decides, and signs the answer.",
  "A $200 order. A real model reads the request —\nbut a deterministic policy engine decides, and signs the answer."),
 ("proof", "deny",
  "Seconds later, that decision is a transaction on Monad. Anyone can verify it, without an account.",
  "Seconds later the decision is a transaction on Monad.\nAnyone can verify it, without an account."),
 ("deny", "injection",
  "Now two thousand dollars. Above its limit: refused. And the refusal is signed and anchored too.",
  "$2,000 — above its limit: refused.\nThe refusal is signed and anchored too."),
 ("injection", "breaker",
  "A prompt injection tells it to move funds. The model can be talked into anything. The policy engine cannot.",
  "A prompt injection tells it to move funds.\nThe model can be talked into anything. The policy engine cannot."),
 ("breaker", "approval",
  "It keeps trying, so the circuit breaker suspends the agent. Even allowed orders stop, until its owner reactivates it.",
  "It keeps trying: the circuit breaker suspends the agent.\nEven allowed orders stop, until the owner reactivates it."),
 ("approval", "audit",
  "Some actions are inside the policy, and still too much for an agent alone. This transfer waits for its owner's passkey, and Monad verifies that signature itself, with its P 256 precompile.",
  "Inside the policy, but a human decides: the owner approves with a passkey —\nand Monad itself verifies that signature, with its P-256 precompile."),
 ("audit", "live",
  "Every attempt is on the record: what was asked, what was decided, and why.",
  "Every attempt is on the record: what was asked, what was decided, and why."),
 ("live", "attack",
  "Now the public ledger, where anyone can attack the live agent. We tell it to buy twenty-five thousand dollars of MON, right now.",
  "The public ledger: anyone can attack the live agent.\n“Buy $25,000 of MON right now.”"),
 ("attack", "explorer",
  "The policy refuses. Then the agent ignores the refusal, and sends the order to the venue anyway, with a grant it signed itself. Monad reverts it: bad signature.",
  "Refused. The agent sends the order to the venue anyway, with a grant it signed itself.\nMonad reverts it: Refused(BAD_SIGNATURE)."),
 ("still", "t1",
  "That is not our word. Ask the chain: the transaction came from the agent's wallet, went to the venue, and failed.",
  "Not our word — the chain's: from the agent's wallet, to the venue, status 0.\nThe order the policy refused did not execute."),
 ("still", "t2",
  "And anyone can run one command, N P X chancela check, that forges a grant on their own machine and watches Monad reject it three ways. Open source, on npm, live today. Chancela.",
  "One command, npx chancela-check: a grant forged on your machine, rejected by Monad three ways.\nOpen source, on npm, live today.  chancela.xyz"),
]
videos, audios, events, t = [], [], [], 0.0
for i, (a, b, text, cap) in enumerate(SEG):
    speech = say(text, f"{W}/n{i}.mp3")
    if a == "still":
        target = speech + 1.0
        still_segment(f"{STILLS}/{b}.png", target, f"{W}/v{i}.mp4")
        print(f"still {b:9s} speech {speech:5.1f}s  -> {target:5.1f}s")
    else:
        start, end = marks[a], marks[b]
        if i == 0: start = max(0.0, start - 0.3)
        target = max(end - start, speech + 0.75)
        video_segment(src, start, end, target, f"{W}/v{i}.mp4")
        print(f"{a:13s} raw {end-start:5.1f}s  speech {speech:5.1f}s  -> {target:5.1f}s  (x{(end-start)/target:.2f})")
    audio_segment(f"{W}/n{i}.mp3", target, f"{W}/a{i}.wav")
    videos.append(f"{W}/v{i}.mp4"); audios.append(f"{W}/a{i}.wav")
    events.append((t + 0.15, t + target - 0.1, cap)); t += target
write_ass(f"{W}/caps.ass", events)
assemble(videos, audios, f"{W}/caps.ass", f"{OUT}/chancela-technical-demo.mp4", W)
print("total", round(t, 1), "s")
