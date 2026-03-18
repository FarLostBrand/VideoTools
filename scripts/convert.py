#!/usr/bin/env python3
"""
VideoTools converter - codec conversion and format conversion.
Usage:
  python convert.py --mode h264 --files file1 [file2 ...] [--outdir /path] [--crf 23]
  python convert.py --mode mp4  --files file1 [file2 ...] [--outdir /path] [--quality medium]
  python convert.py --format mp3 --files file1 [file2 ...] [--outdir /path] [--quality high]
"""
import argparse
import subprocess
import sys
import os
import json
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv", ".ts", ".mts"}

# ── Codec modes (editing/archival) ────────────────────────
CODEC_MODES = {
    "h264": {
        "label": "Delivery (H.264)",
        "ext": ".mp4",
        "build_args": lambda crf, **_: [
            "-c:v", "libx264", "-crf", str(crf), "-preset", "slow",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart"
        ],
    },
    "h265": {
        "label": "HEVC (H.265)",
        "ext": ".mp4",
        "build_args": lambda crf, **_: [
            "-c:v", "libx265", "-crf", str(crf), "-preset", "slow",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", "-tag:v", "hvc1"
        ],
    },
    "clip": {
        "label": "Clip (ProRes Proxy)",
        "ext": ".mov",
        "build_args": lambda **_: [
            "-c:v", "prores_ks", "-profile:v", "0",
            "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"
        ],
    },
    "edit": {
        "label": "Edit (ProRes 422)",
        "ext": ".mov",
        "build_args": lambda **_: [
            "-c:v", "prores_ks", "-profile:v", "2",
            "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"
        ],
    },
    "color": {
        "label": "Color (ProRes 422 HQ)",
        "ext": ".mov",
        "build_args": lambda **_: [
            "-c:v", "prores_ks", "-profile:v", "3",
            "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"
        ],
    },
    "main": {
        "label": "Main (DNxHR HQ)",
        "ext": ".mov",
        "build_args": lambda filepath="", **_: [
            "-c:v", "dnxhd", "-profile:v", "dnxhr_hq",
            "-pix_fmt", "yuv422p", "-b:v", get_dnxhr_bitrate(filepath),
            "-c:a", "pcm_s16le"
        ],
    },
    "quality": {
        "label": "Quality (ProRes 4444)",
        "ext": ".mov",
        "build_args": lambda **_: [
            "-c:v", "prores_ks", "-profile:v", "4",
            "-pix_fmt", "yuv444p10le", "-c:a", "pcm_s16le"
        ],
    },
}

# ── Format conversion targets ─────────────────────────────
FORMAT_TARGETS = {
    # Video formats
    "mp4":  { "label": "MP4",  "ext": ".mp4",  "build_args": lambda q, **_: ["-c:v", "libx264", "-crf", q_to_crf(q), "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"] },
    "mkv":  { "label": "MKV",  "ext": ".mkv",  "build_args": lambda q, **_: ["-c:v", "libx264", "-crf", q_to_crf(q), "-preset", "slow", "-c:a", "aac", "-b:a", "192k"] },
    "mov":  { "label": "MOV",  "ext": ".mov",  "build_args": lambda q, **_: ["-c:v", "libx264", "-crf", q_to_crf(q), "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"] },
    "webm": { "label": "WebM", "ext": ".webm", "build_args": lambda q, **_: ["-c:v", "libvpx-vp9", "-crf", q_to_crf(q), "-b:v", "0", "-c:a", "libopus", "-b:a", "128k"] },
    "avi":  { "label": "AVI",  "ext": ".avi",  "build_args": lambda q, **_: ["-c:v", "libx264", "-crf", q_to_crf(q), "-preset", "slow", "-c:a", "mp3", "-b:a", "192k"] },
    # Audio formats
    "mp3":  { "label": "MP3",  "ext": ".mp3",  "build_args": lambda q, **_: ["-vn", "-c:a", "libmp3lame", "-b:a", q_to_audio_bitrate(q)] },
    "aac":  { "label": "AAC",  "ext": ".aac",  "build_args": lambda q, **_: ["-vn", "-c:a", "aac",        "-b:a", q_to_audio_bitrate(q)] },
    "wav":  { "label": "WAV",  "ext": ".wav",  "build_args": lambda q, **_: ["-vn", "-c:a", "pcm_s16le"] },
    "flac": { "label": "FLAC", "ext": ".flac", "build_args": lambda q, **_: ["-vn", "-c:a", "flac"] },
    "opus": { "label": "Opus", "ext": ".opus", "build_args": lambda q, **_: ["-vn", "-c:a", "libopus",    "-b:a", q_to_audio_bitrate(q)] },
}

QUALITY_PRESETS = { "low": 0, "medium": 1, "high": 2, "lossless": 3 }

def q_to_crf(q: int | str) -> str:
    """Map quality index to CRF (lower = better)."""
    if isinstance(q, str): q = QUALITY_PRESETS.get(q, 1)
    return str([28, 23, 18, 12][q])

def q_to_audio_bitrate(q: int | str) -> str:
    if isinstance(q, str): q = QUALITY_PRESETS.get(q, 1)
    return ["128k", "192k", "256k", "320k"][q]

def log(msg: str):
    print(msg, flush=True)

def check_dependencies():
    missing = []
    for cmd in ["ffmpeg", "ffprobe"]:
        result = subprocess.run(
            ["which" if sys.platform != "win32" else "where", cmd],
            capture_output=True,
        )
        if result.returncode != 0:
            missing.append(cmd)
    return missing

def probe_video(filepath: str):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate",
         "-of", "json", filepath],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None, None, None
    try:
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        width = int(stream["width"])
        height = int(stream["height"])
        num, den = stream["r_frame_rate"].split("/")
        fps = float(num) / float(den)
        return width, height, fps
    except Exception:
        return None, None, None

def get_dnxhr_bitrate(filepath: str) -> str:
    width, _, fps = probe_video(filepath)
    if width is None: return "145M"
    if width <= 1280: return "36M"
    elif width <= 1920: return "115M" if (fps or 30) <= 30 else "145M"
    else: return "220M"

def run_ffmpeg(src: Path, out: Path, extra_args: list[str]) -> bool:
    log(f"[START] {src.name} → {out.name}")
    args = ["ffmpeg", "-y", "-i", str(src)] + extra_args + [str(out)]
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in process.stdout:
        line = line.rstrip()
        if not line: continue
        if any(k in line for k in ["frame=", "fps=", "time=", "speed="]):
            log(f"[PROGRESS] {line}")
        elif any(k in line for k in ["Error", "error", "Invalid", "No such"]):
            log(f"[ERROR] {line}")
    process.wait()
    if process.returncode == 0:
        log(f"[DONE]  {out.name}")
        return True
    else:
        log(f"[FAIL]  {src.name} (exit {process.returncode})")
        return False

def collect_files(files: list[str], folder: str | None) -> list[str]:
    result = []
    if folder:
        for f in sorted(Path(folder).iterdir()):
            if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
                result.append(str(f))
    for f in (files or []):
        p = Path(f)
        if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS:
            result.append(str(p))
    return result

def output_path(src: Path, ext: str, outdir: str | None, suffix: str) -> Path:
    name = f"{src.stem}_{suffix}{ext}"
    if outdir:
        return Path(outdir) / name
    return src.parent / name

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--files",   nargs="*", default=[])
    parser.add_argument("--folder",  default=None)
    parser.add_argument("--outdir",  default=None)
    # Codec conversion
    parser.add_argument("--mode",    default=None, choices=list(CODEC_MODES.keys()))
    parser.add_argument("--crf",     type=int, default=23, help="CRF for H.264/H.265 (0-51, lower=better)")
    # Format conversion
    parser.add_argument("--format",  default=None, choices=list(FORMAT_TARGETS.keys()))
    parser.add_argument("--quality", default="medium", choices=list(QUALITY_PRESETS.keys()))
    args = parser.parse_args()

    if not args.mode and not args.format:
        log("[ERROR] Specify --mode or --format")
        sys.exit(1)

    missing = check_dependencies()
    if missing:
        log(f"[ERROR] Missing dependencies: {', '.join(missing)}")
        sys.exit(1)

    files = collect_files(args.files, args.folder)
    if not files:
        log("[ERROR] No video files found.")
        sys.exit(1)

    if args.outdir:
        os.makedirs(args.outdir, exist_ok=True)

    if args.mode:
        cfg = CODEC_MODES[args.mode]
        log(f"[INFO]  Mode: {cfg['label']}")
        log(f"[INFO]  Files to convert: {len(files)}")
        if args.outdir: log(f"[INFO]  Output dir: {args.outdir}")

        success = 0
        for f in files:
            src = Path(f)
            extra = cfg["build_args"](crf=args.crf, filepath=f)
            out = output_path(src, cfg["ext"], args.outdir, args.mode)
            if run_ffmpeg(src, out, extra):
                success += 1
        log(f"[DONE]  {success}/{len(files)} files converted successfully.")
        sys.exit(0 if success == len(files) else 1)

    if args.format:
        cfg = FORMAT_TARGETS[args.format]
        q_idx = QUALITY_PRESETS[args.quality]
        log(f"[INFO]  Format: {cfg['label']}  Quality: {args.quality}")
        log(f"[INFO]  Files to convert: {len(files)}")
        if args.outdir: log(f"[INFO]  Output dir: {args.outdir}")

        success = 0
        for f in files:
            src = Path(f)
            extra = cfg["build_args"](q=q_idx)
            out = output_path(src, cfg["ext"], args.outdir, args.format)
            if run_ffmpeg(src, out, extra):
                success += 1
        log(f"[DONE]  {success}/{len(files)} files converted successfully.")
        sys.exit(0 if success == len(files) else 1)

if __name__ == "__main__":
    main()
