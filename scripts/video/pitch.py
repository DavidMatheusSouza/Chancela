import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import *
lib.RATE = sys.argv[1] if len(sys.argv) > 1 else "+3%"
REC = os.environ.get("RECORDING", "recording")   # output of record-demo-captioned.mjs
OUT = os.environ.get("VIDEO_OUT", "video-out")
W = f"{OUT}/pitch"; os.makedirs(W, exist_ok=True)
marks = json.load(open(f"{REC}/marks.json"))
src = sorted(glob.glob(f"{REC}/*.webm"))[-1]

SEG = [
 ("still", "s1", "Hi. I built Chancela alone, in Brazil, during this hackathon. I don't speak English, so a synthetic voice is reading my words. I built it because AI agents are becoming more autonomous every month, and there is still no reliable way to say who they are, what they are allowed to do, and to hold them accountable for their actions."),
 ("still", "s2", "Companies are already handing agents real tools: wallets, customer data, email. But an agent's judgement is a language model, and it can be talked into anything. Today's protection is a system prompt that says: please don't. And when something goes wrong, the only record is the company's own log."),
 ("clip", ("allow", "injection"), "Chancela is an identity and authorization layer. It interprets the agent's intent, checks its permissions and policies, allows or blocks the action, and records a verifiable proof on Monad. The decision never comes from the model, and refusals are recorded too."),
 ("still", "s4", "It only works on Monad: one transaction per decision needs sub-second finality, and fees close to zero."),
 ("still", "s5", "The first users are teams building trading, treasury and payment agents. Each will write an if statement. What they won't write is the rest: replay protection, parameter binding, key separation, a circuit breaker. And nobody can write, alone, a check that outsiders can verify. That is the product."),
 ("still", "s6", "It is live on testnet, with packages on npm, and integrates with one H T T P call. When a human must decide, they approve with a passkey, and Monad verifies that signature itself. Next: three agent teams, and mainnet. It is open source, and the owner, not the platform, chooses whose signature counts. Thank you."),
]
SHOW = {"H T T P": "HTTP", "S D K": "SDK"}

def chunks(text):
    for k, v in SHOW.items(): text = text.replace(k, v)
    parts = [p.strip() for p in re.split(r"(?<=[.:?!])\s+", text) if p.strip()]
    out = []
    for p in parts:
        words = p.split()
        while len(words) > 16:
            cut = 13
            for j in range(16, 8, -1):
                if words[j - 1].endswith(","): cut = j; break
            out.append(" ".join(words[:cut])); words = words[cut:]
        out.append(" ".join(words))
    merged = []
    for c in out:
        if merged and len(merged[-1].split()) + len(c.split()) <= 9: merged[-1] += " " + c
        else: merged.append(c)
    return merged

def two_lines(c):
    w = c.split()
    if len(w) <= 8: return c
    h = (len(w) + 1) // 2
    return " ".join(w[:h]) + "\n" + " ".join(w[h:])

videos, audios, events, t = [], [], [], 0.0
for i, (kind, what, text) in enumerate(SEG):
    speech = say(text, f"{W}/n{i}.mp3")
    target = speech + 0.8
    if kind == "still":
        still_segment(f"{OUT}/slides/{what}.png", target, f"{W}/v{i}.mp4")
    else:
        video_segment(src, marks[what[0]], marks[what[1]], target, f"{W}/v{i}.mp4")
    audio_segment(f"{W}/n{i}.mp3", target, f"{W}/a{i}.wav")
    videos.append(f"{W}/v{i}.mp4"); audios.append(f"{W}/a{i}.wav")
    cs = chunks(text); total = sum(len(c) for c in cs); cur = t + 0.25
    for c in cs:
        d = speech * len(c) / total
        events.append((cur, cur + d - 0.05, two_lines(c))); cur += d
    print(f"seg {i} {kind:5s} speech {speech:5.1f}s  start {t:6.1f}s")
    t += target
write_ass(f"{W}/caps.ass", events)
assemble(videos, audios, f"{W}/caps.ass", f"{OUT}/chancela-pitch.mp4", W)
print("total", round(t, 1), "s")
