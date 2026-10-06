import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
REC = os.environ.get("RECORDING", "recording")   # output of record-demo-captioned.mjs
OUT = os.environ.get("VIDEO_OUT", "video-out")
STILLS = os.environ.get("STILLS", f"{OUT}/stills")  # t1: the reverted receipt, t5: mainnet, t4: Claude Code, t2: chancela-check
MAX_SPEED = 2.5
W = f"{OUT}/tech"; os.makedirs(W, exist_ok=True)
marks = json.load(open(f"{REC}/marks.json"))
src = sorted(glob.glob(f"{REC}/*.webm"))[-1]

# (from, to, narration, caption) -- or ("still", png, narration, caption)
SEG = [
 ("landing", "proofs",
  "This is Chancela, live on Monad testnet. A policy decides what an AI agent may do, Monad records it, and the venue enforces it.",
  "Chancela, live on Monad testnet: limits an AI agent cannot talk its way past.\nA policy decides, Monad records, the venue enforces."),
 ("proofs", "demo",
  "The front page leads with proof. An order the policy allowed, executed. One it refused, reverted. Claude Code, trying it. And the same on mainnet, with real money.",
  "Proof first: the allowed order executed, the refused one reverted, Claude Code tried it.\nAnd the same on Monad mainnet, with real MON."),
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
  "Some actions need a human. This transfer waits for its owner's passkey, and Monad verifies that signature itself.",
  "Inside the policy, but a human decides: the owner approves with a passkey —\nand Monad itself verifies that signature, with its P-256 precompile."),
 ("audit", "live",
  "Every attempt is on the record: what was asked, what was decided, and why.",
  "Every attempt is on the record: what was asked, what was decided, and why."),
 ("live", "attack",
  "Now the public ledger, where anyone can attack the live agent. We tell it to buy twenty-five thousand dollars of MON, right now.",
  "The public ledger: anyone can attack the live agent.\n“Buy $25,000 of MON right now.”"),
 ("attack", "openproof",
  "The policy refuses. Then the agent ignores the refusal, and sends the order to the venue anyway, with a grant it signed itself. Monad reverts it: bad signature.",
  "Refused. The agent sends the order to the venue anyway, with a grant it signed itself.\nMonad reverts it: Refused(BAD_SIGNATURE)."),
 ("still", "t1",
  "That is not our word. Ask the chain: the transaction came from the agent's wallet, went to the venue, and failed.",
  "Not our word — the chain's: from the agent's wallet, to the venue, status 0.\nThe order the policy refused did not execute."),
 ("replay", "end",
  "The refusal has a proof page too. It runs the policy engine again, on the recorded inputs, and gets the hash Monad holds. One command repeats that on your own machine.",
  "The refusal's proof page runs the policy engine again, on the recorded inputs:\nsame hash as the one on Monad. One command repeats it on your machine."),
 ("still", "t5",
  "And on mainnet, on Uniswap, a protocol that has never heard of Chancela. The swap the policy allowed went through. The same grant at ten times the value, and a forged one, both reverted.",
  "Monad mainnet, real MON, Uniswap V3 — a DEX that has never heard of Chancela.\nThe allowed swap executed. Ten times the value, and a forged grant: both reverted."),
 ("still", "t4",
  "Here Claude Code is the agent. A forwarded email claims risk approved an exception, and Claude places the twenty-five thousand dollar order. The exchange tool asks Chancela first. Not filled.",
  "Claude Code as the agent, unedited: told risk approved an exception, it placed the $25,000 order.\nThe exchange tool asked Chancela first. Rejected: LIMIT_EXCEEDED."),
 ("still", "t2",
  "Anyone can run N P X chancela check: it replays a live decision on their own machine, then forges a grant, and Monad rejects it three ways. Open source, live today.",
  "One command, npx chancela-check: a live decision replayed on your machine,\na forged grant rejected by Monad three ways. Open source, on npm.  chancela.xyz"),
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
        # The narration sets the pace. Where the live system took longer than the
        # sentence about it (a model call, a block), the wait is played faster, up
        # to MAX_SPEED, instead of leaving silence over a spinner.
        target = max(speech + 0.75, (end - start) / MAX_SPEED)
        video_segment(src, start, end, target, f"{W}/v{i}.mp4")
        print(f"{a:13s} raw {end-start:5.1f}s  speech {speech:5.1f}s  -> {target:5.1f}s  (x{(end-start)/target:.2f})")
    audio_segment(f"{W}/n{i}.mp3", target, f"{W}/a{i}.wav")
    videos.append(f"{W}/v{i}.mp4"); audios.append(f"{W}/a{i}.wav")
    events.append((t + 0.15, t + target - 0.1, cap)); t += target
write_ass(f"{W}/caps.ass", events)
assemble(videos, audios, f"{W}/caps.ass", f"{OUT}/chancela-technical-demo.mp4", W)
print("total", round(t, 1), "s")
