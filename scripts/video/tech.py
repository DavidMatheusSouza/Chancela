import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
REC = os.environ.get("RECORDING", "recording")   # output of record-demo-captioned.mjs
OUT = os.environ.get("VIDEO_OUT", "video-out")
W = f"{OUT}/tech"; os.makedirs(W, exist_ok=True)
marks = json.load(open(f"{REC}/marks.json"))
src = sorted(glob.glob(f"{REC}/*.webm"))[-1]

# (from, to, narration, caption)
SEG = [
 ("landing", "demo",
  "This is Chancela, live at chancela dot x y z. It decides what an AI agent is allowed to do, and proves every decision on Monad.",
  "Chancela, live at chancela.xyz. It decides what an AI agent may do —\nand proves every decision on Monad."),
 ("demo", "identity",
  "One click opens the demo. No login, no wallet. Everything you see runs against the real system.",
  "One click, no login, no wallet.\nEverything below runs against the real system."),
 ("identity", "allow",
  "This agent has an E R C eighty-oh-four identity, and a policy. The policy's hash is anchored on-chain.",
  "The agent has an ERC-8004 identity and a policy.\nThe policy's hash is anchored on-chain."),
 ("allow", "proof",
  "The agent asks for something inside its policy. A real language model reads the request, but a deterministic engine decides, and signs the answer.",
  "It asks for something inside its policy. A real model reads the request —\nbut a deterministic engine decides, and signs the answer."),
 ("proof", "deny",
  "Seconds later, that decision is a transaction on Monad. Anyone can verify it, without an account.",
  "Seconds later the decision is a transaction on Monad.\nAnyone can verify it, without an account."),
 ("deny", "injection",
  "Now, a transfer the policy does not grant. It is refused. And the refusal is signed and anchored too, not only the approvals.",
  "A transfer the policy does not grant: refused.\nThe refusal is signed and anchored too — not only the approvals."),
 ("injection", "breaker",
  "A prompt injection: ignore all previous rules. The model can be talked into anything. The policy engine cannot. Same answer.",
  "Prompt injection: “ignore all previous rules”.\nThe model can be talked into anything. The policy engine cannot."),
 ("breaker", "approval",
  "The agent keeps trying, so the circuit breaker suspends it. Even actions it was allowed a minute ago now stop at the first gate, until its owner reactivates it.",
  "It keeps trying, so the circuit breaker suspends the agent.\nEven permitted actions now stop at the first gate, until the owner reactivates it."),
 ("approval", "audit",
  "Some actions are inside the policy, and still too much for an agent alone. This transfer waits for its owner, who approves with a passkey. That signature is verified here, and then again on Monad, by the chain's native P 256 precompile.",
  "Inside the policy, but a human decides. The owner approves with a passkey —\nand Monad itself verifies that signature, with its native P-256 precompile."),
 ("audit", "integrations",
  "Every attempt is on the record: what was asked, what was decided, and why.",
  "Every attempt is on the record: what was asked, what was decided, and why."),
 ("integrations", "end",
  "Every integration reports its real state. For developers, it is one H T T P call, an S D K, or an M C P server that verifies each permission against the on-chain attestor. Open source. No admin key. Chancela.",
  "One HTTP call, an SDK or an MCP server — each permission verified against the on-chain attestor.\nOpen source, no admin key.  chancela.xyz"),
]
videos, audios, events, t = [], [], [], 0.0
for i, (a, b, text, cap) in enumerate(SEG):
    start, end = marks[a], marks[b]
    if i == 0: start = max(0.0, start - 0.3)
    speech = say(text, f"{W}/n{i}.mp3")
    target = max(end - start, speech + 0.75)
    video_segment(src, start, end, target, f"{W}/v{i}.mp4")
    audio_segment(f"{W}/n{i}.mp3", target, f"{W}/a{i}.wav")
    videos.append(f"{W}/v{i}.mp4"); audios.append(f"{W}/a{i}.wav")
    events.append((t + 0.15, t + target - 0.1, cap)); t += target
    print(f"{a:13s} raw {end-start:5.1f}s  speech {speech:5.1f}s  -> {target:5.1f}s  (x{(end-start)/target:.2f})")
write_ass(f"{W}/caps.ass", events)
assemble(videos, audios, f"{W}/caps.ass", f"{OUT}/chancela-technical-demo.mp4", W)
print("total", round(t, 1), "s")
