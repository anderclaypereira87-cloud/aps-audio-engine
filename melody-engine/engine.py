"""APS Melody Engine: local audio preparation and pitch analysis.

Voice conversion is intentionally gated behind an explicitly configured RVC adapter.
No implicit downloads, model training, or remote uploads occur.
"""
from __future__ import annotations
import argparse
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

DEFAULTS = {"pitchCorrection": 65, "naturalness": 85, "preserveOriginalMelody": True}
ALLOWED_EXT = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


def validate_settings(settings):
    out = dict(DEFAULTS)
    out.update(settings)
    for key in ("pitchCorrection", "naturalness"):
        val = out[key]
        if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val) or not 0 <= val <= 100:
            raise ValueError(f"{key} must be a number between 0 and 100")
    if not isinstance(out["preserveOriginalMelody"], bool):
        raise ValueError("preserveOriginalMelody must be boolean")
    return out


def run_command(argv, timeout=3600):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=timeout)


def split_vocals(source: Path, workspace: Path):
    if shutil.which("demucs") is None:
        raise RuntimeError("Demucs not installed. Install separately in a GPU worker.")
    source = source.resolve()
    if not source.is_file() or source.suffix.lower() not in ALLOWED_EXT:
        raise ValueError("Unsupported or missing input audio")
    workspace.mkdir(parents=True, exist_ok=True)
    run_command(["demucs", "--two-stems=vocals", "-o", str(workspace), str(source)])
    candidates = list(workspace.rglob("vocals.wav"))
    if len(candidates) != 1:
        raise RuntimeError("Demucs did not produce exactly one vocal stem")
    vocals = candidates[0]
    instrumental = vocals.with_name("no_vocals.wav")
    if not instrumental.is_file():
        raise RuntimeError("Demucs did not produce instrumental stem")
    return vocals, instrumental


def analyze_pitch(vocal_path: Path, output_path: Path):
    y, sr = librosa.load(str(vocal_path), sr=22050, mono=True)
    if not len(y):
        raise ValueError("Empty vocal audio")
    f0, voiced, probability = librosa.pyin(y, sr=sr, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), frame_length=2048, hop_length=256)
    times = librosa.times_like(f0, sr=sr, hop_length=256)
    rows = [{"time": round(float(t), 4), "hz": round(float(f), 2) if np.isfinite(f) else None, "voiced": bool(v), "confidence": round(float(p), 3) if np.isfinite(p) else None} for t, f, v, p in zip(times, f0, voiced, probability)]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"sampleRate": sr, "hopLength": 256, "frames": rows}, ensure_ascii=False), encoding="utf-8")
    return len(rows)


def prepare(source: Path, output: Path, settings: dict):
    cfg = validate_settings(settings)
    vocals, instrumental = split_vocals(source, output / "stems")
    pitch = output / "pitch-analysis.json"
    analyze_pitch(vocals, pitch)
    manifest = {"status": "prepared_not_converted", "settings": cfg, "vocals": str(vocals), "instrumental": str(instrumental), "pitchAnalysis": str(pitch), "notes": "Pitch analysis is not pitch correction; voice model and conversion adapter must be installed and validated."}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--correction", type=float, default=65)
    parser.add_argument("--naturalness", type=float, default=85)
    args = parser.parse_args()
    result = prepare(args.source, args.output, {"pitchCorrection": args.correction, "naturalness": args.naturalness})
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
