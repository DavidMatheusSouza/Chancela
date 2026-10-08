# The two submission videos

Both are generated, not filmed: real footage of the live site, slides in the
site's own style, a synthetic English voice and burnt-in captions. Nobody has to
speak, and either can be rebuilt in a few minutes after the product changes.

```bash
npx playwright install chromium                      # once
python3 -m venv .tts && .tts/bin/pip install edge-tts  # once; needs ffmpeg with libass

node scripts/record-demo-captioned.mjs https://chancela.xyz recording

# slides and terminal stills -> PNG: the pitch deck's slide files (deck/project/…),
# plus receipt.txt (`cast receipt <reverted tx>`), pair.txt, claude.txt, mainnet.txt and check-gate.txt (the replay
# and gate lines of a real `npx chancela-check` run) in the same folder
node scripts/video/render-stills.mjs <folder>     # -> video-out/slides/s1..s10.png, stills/t1,t2.png

RECORDING=$PWD/recording VIDEO_OUT=$PWD/video-out STILLS=$PWD/stills .tts/bin/python scripts/video/tech.py  # <= 3:00
RECORDING=$PWD/recording VIDEO_OUT=$PWD/video-out .tts/bin/python scripts/video/pitch.py  # <= 2:00
```

`tech.py` stretches each step of the recording to the length of its narration,
using the step times the recorder noted, so voice, captions and picture stay
together whatever the run's pace was. Where the live system took longer than
the sentence about it, the wait is played faster (at most 2.5x) rather than left
as silence. The recorder zooms the page (`ZOOM`, 1.35 by default) so the text is
readable in a small player, and the sound is normalised to -14 LUFS. `pitch.py` alternates slides with a clip of
the product. The narration says plainly that it is a synthetic voice.

The voice of both videos is the "Julian" preset on Higgsfield (ElevenLabs
engine), generated one clip per segment of `SEG`; the narration text is sent
there and nothing else is. `say()` keeps any clip that already exists, so the
clips go in `video-out/pitch/` and `video-out/tech/` as `n0.mp3`, `n1.mp3`, …
before the scripts run. With none there, `say()` falls back to Microsoft's
public text-to-speech endpoint via `edge-tts`, the voice of the earlier cuts.
The pitch of 8 Oct was built with `PAD=0.65` (the pause after each segment,
0.8 by default) to stay under 2:00.
