# The two submission videos

Both are generated, not filmed: real footage of the live site, slides in the
site's own style, a synthetic English voice and burnt-in captions. Nobody has to
speak, and either can be rebuilt in a few minutes after the product changes.

```bash
npx playwright install chromium                      # once
python3 -m venv .tts && .tts/bin/pip install edge-tts  # once; needs ffmpeg with libass

node scripts/record-demo-captioned.mjs https://chancela.xyz recording

# slides and terminal stills -> PNG: the pitch deck's slide files (deck/project/…),
# plus receipt.txt (`cast receipt <reverted tx>`) and check-gate.txt (the gate
# half of a real `npx chancela-check` run) in the same folder
node scripts/video/render-stills.mjs <folder>     # -> video-out/slides/s1..s10.png, stills/t1,t2.png

RECORDING=$PWD/recording VIDEO_OUT=$PWD/video-out STILLS=$PWD/stills .tts/bin/python scripts/video/tech.py  # <= 3:00
RECORDING=$PWD/recording VIDEO_OUT=$PWD/video-out .tts/bin/python scripts/video/pitch.py  # <= 2:00
```

`tech.py` stretches each step of the recording to the length of its narration,
using the step times the recorder noted, so voice, captions and picture stay
together whatever the run's pace was. `pitch.py` alternates slides with a clip of
the product. The narration says plainly that it is a synthetic voice.

The voice comes from Microsoft's public text-to-speech endpoint via `edge-tts`;
the narration text is sent there and nothing else is.
