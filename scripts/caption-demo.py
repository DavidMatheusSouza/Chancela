#!/usr/bin/env python3
"""Burn captions into a recording made by record-demo-captioned.mjs.

The capture is slowed to 0.7x: the guided run moves faster than anyone can read
a sentence, and the three-minute limit leaves room. Caption times come from
marks.json, so they follow what happened in this run.

    python3 scripts/caption-demo.py <recording-dir>
"""
import glob, json, subprocess, sys

out = sys.argv[1] if len(sys.argv) > 1 else "recording"
marks = json.load(open(f"{out}/marks.json"))
video = sorted(glob.glob(f"{out}/*.webm"))[-1]
SPEED = 0.7

CAPTIONS = [
    ("landing", "demo", "Chancela decides what an AI agent may do — and proves it on Monad.\nThis is the live site at chancela.xyz, not a mock-up."),
    ("demo", "identity", "One click, no login, no wallet.\nEverything below runs against the real system."),
    ("identity", "allow", "The agent has an ERC-8004 identity and a policy.\nThe policy's hash is anchored on-chain."),
    ("allow", "proof", "It asks for something inside its policy. A real model reads the request —\nbut a deterministic engine decides, and signs the answer."),
    ("proof", "deny", "Seconds later the decision is a transaction on Monad.\nAnyone can verify it, without an account."),
    ("deny", "injection", "A transfer the policy does not grant: refused.\nThe refusal is signed and anchored too — not only the yeses."),
    ("injection", "breaker", "Prompt injection: “ignore all previous rules”.\nThe model can be talked into anything. The policy engine cannot."),
    ("breaker", "approval", "It keeps trying, so the circuit breaker suspends the agent.\nEven permitted actions now stop at the first gate, until the owner reactivates it."),
    ("approval", "audit", "Inside the policy, but a human decides. The owner approves with a passkey —\nand Monad itself verifies that signature, with its native P-256 precompile."),
    ("audit", "integrations", "Every attempt is on the record: what was asked, what was decided, and why."),
    ("integrations", "end", "Every integration reports its real state. Open source, no admin key.\nchancela.xyz  ·  github.com/DavidMatheusSouza/Chancela"),
]


def stamp(seconds: float) -> str:
    t = seconds / SPEED
    return "%d:%02d:%05.2f" % (t // 3600, t % 3600 // 60, t % 60)


HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8100A09,0,0,0,0,100,100,0,0,3,14,0,2,260,120,56,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

events = [
    "Dialogue: 0,%s,%s,Cap,,0,0,0,,%s" % (stamp(marks[a] + 0.15), stamp(marks[b] - 0.1), text.replace("\n", "\\N"))
    for a, b, text in CAPTIONS
    if a in marks and b in marks
]
open(f"{out}/caps.ass", "w", encoding="utf-8").write(HEAD + "\n".join(events) + "\n")

target = f"{out}/chancela-technical-demo.mp4"
subprocess.run(
    ["ffmpeg", "-v", "error", "-y", "-i", video,
     "-vf", f"setpts=PTS/{SPEED},fps=30,ass={out}/caps.ass",
     "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
     "-pix_fmt", "yuv420p", "-movflags", "+faststart", target],
    check=True,
)
print(target)
