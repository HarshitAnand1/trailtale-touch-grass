"""
Trailtale vision checker.
Uses a local multimodal model (Gemma via llama.cpp) to confirm quest photo matches.
Returns yes/no plus a one-line reason.
"""

import httpx
import base64
import logging
from pathlib import Path
from .models import PhotoCheckResponse

logger = logging.getLogger("trailtale.vision")

# llama.cpp server endpoint for multimodal (if available)
LLAMA_CPP_VISION_URL = "http://127.0.0.1:8080/completion"

VISION_PROMPT = """Look at this photo taken on a nature walk.
The walker is looking for: {quest_target}
Quest description: {quest_title}

Does this photo show the quest target? Answer with exactly:
YES: <one-line reason>
or
NO: <one-line reason>"""


async def check_photo(photo_path: str, quest_id: str, quest_title: str, quest_target: str) -> PhotoCheckResponse:
    """
    Check whether a photo matches a quest target using the vision model.
    Falls back to unconfirmed if the model is unavailable.
    """
    path = Path(photo_path)
    if not path.exists():
        return PhotoCheckResponse(confirmed=False, reason="Photo file not found.")

    try:
        # Read and base64-encode the image
        with open(path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode("utf-8")

        prompt = VISION_PROMPT.format(quest_target=quest_target, quest_title=quest_title)

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                LLAMA_CPP_VISION_URL,
                json={
                    "prompt": prompt,
                    "image_data": [{"data": image_b64, "id": 0}],
                    "n_predict": 60,
                    "temperature": 0.2,
                },
            )
            resp.raise_for_status()
            result = resp.json().get("content", "").strip()

        if result.upper().startswith("YES"):
            reason = result.split(":", 1)[-1].strip() if ":" in result else "Match confirmed."
            return PhotoCheckResponse(confirmed=True, reason=reason)
        else:
            reason = result.split(":", 1)[-1].strip() if ":" in result else "No match detected."
            return PhotoCheckResponse(confirmed=False, reason=reason)

    except Exception as e:
        logger.error("Vision check failed: %s", e)
        return PhotoCheckResponse(
            confirmed=False,
            reason=f"Vision model unavailable. Use the manual 'count it' button instead."
        )
