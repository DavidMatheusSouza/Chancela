import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import *
lib.RATE = sys.argv[1] if len(sys.argv) > 1 else "+3%"
REC = os.environ.get("RECORDING", "recording")   # output of record-demo-captioned.mjs
OUT = os.environ.get("VIDEO_OUT", "video-out")
PAD = float(os.environ.get("PAD", "0.8"))             # silence after each segment
W = f"{OUT}/pitch"; os.makedirs(W, exist_ok=True)
marks = json.load(open(f"{REC}/marks.json"))
src = sorted(glob.glob(f"{REC}/*.webm"))[-1]

SEG = [
 ("still", "s1", "Hi. I'm David, from Brazil, with a background in infrastructure, support and automation. I built Chancela alone during this hackathon, and a synthetic voice is reading my words. Chancela gives AI agents limits they cannot talk their way past."),
 ("still", "s2", "Agents are getting wallets. Sooner or later one will be told to do something it should not: by a user, a web page, or an email. Today its only limit is a system prompt, and nothing stops the transaction."),
 ("clip", ("attack", "openproof"), "Here is Chancela stopping one, live on Monad. A trading agent is told to buy twenty-five thousand dollars. Its policy refuses. It sends the order anyway, and the venue's gate reverts it on-chain."),
 ("still", "s3", "Same agent, same venue: a two hundred dollar order its policy allowed was filled. Both transactions are public."),
 ("still", "s4", "The model only proposes. A deterministic policy decides, and signs. Monad records every decision, refusals included. And the venue enforces it."),
 ("still", "s5", "Who pays? Teams running trading agents, venues, and platforms that host agents. Self-hosting is free; we charge for running the attestor."),
 ("still", "s6", "It only works on Monad: one transaction per decision, under a hundredth of a MON, in sub-second blocks."),
 ("still", "s7", "Wallet spending limits are a good second line, but only the provider can check them. Chancela's record can be checked by anyone."),
 ("still", "s8", "It is live: six verified contracts, four of them on Monad mainnet, four hundred and eighty-two tests, and four packages on npm."),
 ("still", "s9", "One outside team is live: MonFunded, a prop-trading product. Its order bot asks Chancela before every order, with fifteen decisions anchored on Monad testnet so far. On mainnet, our agent made a real Uniswap swap, and its forged order was reverted."),
 ("still", "s10", "Don't trust us. Run N P X chancela check, or open chancela dot x y z. Thank you."),
]
SHOW = {"H T T P": "HTTP", "S D K": "SDK", "N P X chancela check": "npx chancela-check", "chancela dot x y z": "chancela.xyz", "twenty-five thousand dollars": "$25,000", "four hundred and eighty-two": "482", "two hundred dollar": "$200", "E R C eighty-oh-four": "ERC-8004"}

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
    target = speech + PAD
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
