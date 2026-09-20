"""Shared pieces for the narrated videos: speech, captions, cutting, assembling."""
import asyncio, json, os, subprocess, edge_tts

VOICE = "en-US-AndrewNeural"
RATE = "-4%"

def run(*args):
    subprocess.run(list(args), check=True)

def dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())

async def _say(text, path):
    await edge_tts.Communicate(text, VOICE, rate=RATE).save(path)

def say(text, path):
    if not os.path.exists(path):
        asyncio.run(_say(text, path))
    return dur(path)

ASS_HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,36,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8100A09,0,0,0,0,100,100,0,0,3,14,0,2,260,120,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

def stamp(t):
    return "%d:%02d:%05.2f" % (t // 3600, t % 3600 // 60, t % 60)

def write_ass(path, events):
    lines = ["Dialogue: 0,%s,%s,Cap,,0,0,0,,%s" % (stamp(a), stamp(b), text.replace("\n", "\\N")) for a, b, text in events]
    open(path, "w", encoding="utf-8").write(ASS_HEAD + "\n".join(lines) + "\n")

def video_segment(src, start, end, target, out):
    """Cut [start,end] from src and stretch it to last `target` seconds."""
    speed = (end - start) / target
    # Trim inside the filter graph, before retiming. As output options, -ss/-to
    # apply to the *stretched* timestamps and cut the wrong part of the recording.
    run("ffmpeg", "-v", "error", "-y", "-i", src,
        "-vf", f"trim=start={start:.3f}:end={end:.3f},setpts=(PTS-STARTPTS)/{speed:.5f},fps=30,scale=1920:1080", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-t", f"{target:.3f}", out)

def still_segment(png, target, out):
    run("ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", png, "-vf", "fps=30,scale=1920:1080", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-t", f"{target:.3f}", out)

def audio_segment(mp3, target, out, lead=0.25):
    ms = int(lead * 1000)
    run("ffmpeg", "-v", "error", "-y", "-i", mp3, "-af", f"adelay={ms}|{ms},apad", "-t", f"{target:.3f}",
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out)

def assemble(videos, audios, ass, out, workdir):
    vlist, alist = f"{workdir}/v.txt", f"{workdir}/a.txt"
    open(vlist, "w").write("".join(f"file '{v}'\n" for v in videos))
    open(alist, "w").write("".join(f"file '{a}'\n" for a in audios))
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", vlist, "-c", "copy", f"{workdir}/video.mp4")
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", alist, "-c:a", "pcm_s16le", f"{workdir}/audio.wav")
    run("ffmpeg", "-v", "error", "-y", "-i", f"{workdir}/video.mp4", "-i", f"{workdir}/audio.wav",
        "-vf", f"ass={ass}", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", out)
