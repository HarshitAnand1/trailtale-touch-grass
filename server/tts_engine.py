"""
Trailtale text-to-speech engine.
Uses Piper TTS for local voice synthesis.
Falls back to a no-audio stub if Piper is not installed.
"""

import subprocess
import logging
import shutil
from pathlib import Path

logger = logging.getLogger("trailtale.tts")

AUDIO_DIR = Path(__file__).resolve().parent.parent / "data" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Piper default voice — change to match your installed voice
PIPER_VOICE = "en_US-lessac-medium"


def piper_available() -> bool:
    """Check whether the piper binary is on the PATH."""
    return shutil.which("piper") is not None


def synthesise(text: str, filename: str) -> Path:
    """
    Convert text to a WAV file using Piper.
    Returns the path to the generated audio file.
    """
    out_path = AUDIO_DIR / filename
    if out_path.exists():
        return out_path

    if not piper_available():
        logger.warning("Piper not found on PATH — writing silent placeholder")
        _write_silent_wav(out_path)
        return out_path

    try:
        proc = subprocess.run(
            [
                "piper",
                "--model", PIPER_VOICE,
                "--output_file", str(out_path),
            ],
            input=text,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            logger.error("Piper failed: %s", proc.stderr)
            _write_silent_wav(out_path)
    except Exception as e:
        logger.error("TTS error: %s", e)
        _write_silent_wav(out_path)

    return out_path


def _write_silent_wav(path: Path):
    """Write a minimal valid WAV header (silence) so the client can still play something."""
    import struct
    sample_rate = 22050
    duration_s = 2
    num_samples = sample_rate * duration_s
    data_size = num_samples * 2  # 16-bit mono

    with open(path, "wb") as f:
        # RIFF header
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        # fmt chunk
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16))
        # data chunk
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)
