#!/usr/bin/env python3
"""
VideoTools converter - wraps ffmpeg for ProRes / DNxHR codec conversion.
Usage: python convert.py --files file1 [file2 ...] --mode edit --outdir /optional/path
       python convert.py --folder /path/to/folder --mode edit --outdir /optional/path
"""
import argparse
import subprocess
import sys
import os
import json
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv", ".ts", ".mts"}

MODES = {
    "clip": {
        "label": "Clip (ProRes Proxy)",
        "codec": "prores_ks",
        "profile": "0",
        "pix_fmt": "yuv422p10le",
        "bitrate": None,
    },
    "edit": {
        "label": "Edit (ProRes 422)",
        "codec": "prores_ks",
        "profile": "2",
        "pix_fmt": "yuv422p10le",
        "bitrate": None,
    },
    "color": {
        "label": "Color (ProRes 422 HQ)",
        "codec": "prores_ks",
        "profile": "3",
        "pix_fmt": "yuv422p10le",
        "bitrate": None,
    },
    "main": {
        "label": "Main (DNxHR HQ)",
        "codec": "dnxhd",
        "profile": "dnxhr_hq",
        "pix_fmt": "yuv422p",
        "bitrate": "auto",
    },
    "quality": {
        "label": "Quality (ProRes 4444)",
        "codec": "prores_ks",
        "profile": "4",
        "pix_fmt": "yuv444p10le",
        "bitrate": None,
    },
}


def log(msg: str):
    print(msg, flush=True)


def check_dependencies():
    missing = []
    for cmd in ["ffmpeg", "ffprobe"]:
        result = subprocess.run(
            ["which", cmd] if sys.platform != "win32" else ["where", cmd],
            capture_output=True,
        )
        if result.returncode != 0:
            missing.append(cmd)
    return missing


def probe_video(filepath: str):
    """Return (width, height, fps) for a video file."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate",
            "-of", "json",
            filepath,
        ],
        capture_output=True,
        text=True,
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
    if width is None:
        return "145M"
    if width <= 1280:
        return "36M"
    elif width <= 1920:
        return "115M" if fps <= 30 else "145M"
    else:
        return "220M"


def convert_file(filepath: str, mode: str, outdir: str | None = None) -> bool:
    cfg = MODES[mode]
    src = Path(filepath)

    if outdir:
        out_path = Path(outdir) / f"{src.stem}_{mode}.mov"
    else:
        out_path = src.parent / f"{src.stem}_{mode}.mov"

    log(f"[START] {src.name} → {out_path.name}")

    bitrate = cfg["bitrate"]
    if bitrate == "auto":
        bitrate = get_dnxhr_bitrate(filepath)
        log(f"[INFO]  DNxHR bitrate: {bitrate}")

    args = ["ffmpeg", "-y", "-i", filepath, "-c:v", cfg["codec"]]

    if cfg["profile"]:
        args += ["-profile:v", cfg["profile"]]
    if cfg["pix_fmt"]:
        args += ["-pix_fmt", cfg["pix_fmt"]]
    if bitrate and bitrate != "auto":
        args += ["-b:v", bitrate]

    args += ["-c:a", "pcm_s16le", str(out_path)]

    process = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    for line in process.stdout:
        line = line.rstrip()
        if line:
            # Only forward ffmpeg progress/error lines, not every frame stat
            if any(k in line for k in ["frame=", "fps=", "time=", "speed="]):
                print(f"[PROGRESS] {line}", flush=True)
            elif "Error" in line or "error" in line or "Invalid" in line:
                print(f"[ERROR] {line}", flush=True)

    process.wait()

    if process.returncode == 0:
        log(f"[DONE]  {out_path.name}")
        return True
    else:
        log(f"[FAIL]  {src.name} exited with code {process.returncode}")
        return False


def collect_files(files: list[str], folder: str | None) -> list[str]:
    result = []
    if folder:
        p = Path(folder)
        for f in sorted(p.iterdir()):
            if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
                result.append(str(f))
    for f in (files or []):
        p = Path(f)
        if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS:
            result.append(str(p))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--files", nargs="*", default=[], help="One or more video files")
    parser.add_argument("--folder", default=None, help="Folder of videos to convert")
    parser.add_argument("--mode", default="edit", choices=list(MODES.keys()))
    parser.add_argument("--outdir", default=None, help="Output directory (default: same as input)")
    args = parser.parse_args()

    missing = check_dependencies()
    if missing:
        log(f"[ERROR] Missing dependencies: {', '.join(missing)}")
        sys.exit(1)

    if args.mode not in MODES:
        log(f"[ERROR] Unknown mode '{args.mode}'. Valid: {', '.join(MODES.keys())}")
        sys.exit(1)

    files = collect_files(args.files, args.folder)

    if not files:
        log("[ERROR] No video files found.")
        sys.exit(1)

    log(f"[INFO]  Mode: {MODES[args.mode]['label']}")
    log(f"[INFO]  Files to convert: {len(files)}")
    if args.outdir:
        os.makedirs(args.outdir, exist_ok=True)
        log(f"[INFO]  Output dir: {args.outdir}")

    success = 0
    for f in files:
        ok = convert_file(f, args.mode, args.outdir)
        if ok:
            success += 1

    log(f"[DONE]  {success}/{len(files)} files converted successfully.")
    sys.exit(0 if success == len(files) else 1)


if __name__ == "__main__":
    main()
