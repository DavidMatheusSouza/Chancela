# The two submission videos

Both are generated, not filmed: real footage of the live site, slides in the
site's own style, a synthetic English voice and burnt-in captions. Nobody has to
speak, and either can be rebuilt in a few minutes after the product changes.

```bash
npx playwright install chromium                      # once
python3 -m venv .tts && .tts/bin/pip install edge-tts  # once; needs ffmpeg with libass

node scripts/record-demo-captioned.mjs https://chancela.xyz recording

# slides -> PNG (any Chromium; 1920x1080)
mkdir -p video-out/slides
for f in scripts/video/slide-*.html; do n=$(basename "$f" .html | sed -E 's/slide-([0-9]).*/s\1/')
  chromium --headless=new --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=6000 \
    --screenshot="video-out/slides/$n.png" "file://$PWD/$f"; done

RECORDING=recording VIDEO_OUT=video-out .tts/bin/python scripts/video/tech.py    # <= 3:00
RECORDING=recording VIDEO_OUT=video-out .tts/bin/python scripts/video/pitch.py   # <= 2:00
```

`tech.py` stretches each step of the recording to the length of its narration,
using the step times the recorder noted, so voice, captions and picture stay
together whatever the run's pace was. `pitch.py` alternates slides with a clip of
the product. The narration says plainly that it is a synthetic voice.

The voice comes from Microsoft's public text-to-speech endpoint via `edge-tts`;
the narration text is sent there and nothing else is.
