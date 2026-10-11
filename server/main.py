"""
Trailtale orchestrator.
FastAPI server — one process, one walk at a time.
Serves the client PWA, exposes the walk/story/quest/photo APIs.
"""

import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db, get_connection
from .models import (
    StartWalkRequest, StartWalkResponse, EndWalkResponse,
    MotionUpdate, SegmentRequest, PhotoCheckResponse,
)
from .story_engine import create_story, get_story_state, generate_segment
from .quest_engine import (
    get_active_quests, record_quest_find, get_walk_quest_finds, get_unfound_quests,
)
from .tts_engine import synthesise
from .vision_checker import check_photo
from .walk_log import generate_walk_log

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("trailtale")

# ── App setup ─────────────────────────────────────────────────

app = FastAPI(title="Trailtale", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIR = BASE_DIR / "client"
AUDIO_DIR = BASE_DIR / "data" / "audio"
PHOTO_DIR = BASE_DIR / "data" / "photos"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

# Serve audio files
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Trailtale ready")


# ── Walk endpoints ────────────────────────────────────────────

@app.post("/api/walk/start", response_model=StartWalkResponse)
async def start_walk(req: StartWalkRequest):
    """Start a new walk session."""
    now = datetime.now()
    walk_id = now.strftime("%Y-%m-%dT%H:%M")
    story = create_story(genre=req.genre)
    quests = get_active_quests()

    conn = get_connection()
    conn.execute(
        """INSERT INTO walk_sessions (walk_id, started_at, story_id, status)
           VALUES (?, ?, ?, 'active')""",
        (walk_id, now.isoformat(), story.story_id),
    )
    conn.commit()
    conn.close()

    logger.info("Walk started: %s (story: %s, quests: %d)", walk_id, story.story_id, len(quests))
    return StartWalkResponse(walk_id=walk_id, story_id=story.story_id, quests=quests)


@app.post("/api/walk/end", response_model=EndWalkResponse)
async def end_walk(walk_id: str):
    """End a walk and generate the walk log."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM walk_sessions WHERE walk_id = ?", (walk_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Walk not found")

    conn.execute(
        "UPDATE walk_sessions SET ended_at = ?, status = 'ended' WHERE walk_id = ?",
        (datetime.now().isoformat(), walk_id),
    )
    conn.commit()
    conn.close()

    log = generate_walk_log(walk_id)
    logger.info("Walk ended: %s", walk_id)
    return EndWalkResponse(walk_log=log)


@app.post("/api/walk/motion")
async def update_motion(update: MotionUpdate):
    """Receive a motion update from the client to track distance and movement."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM walk_sessions WHERE walk_id = ?", (update.walk_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Walk not found")

    session = dict(row)
    is_moving = update.speed_mps >= 0.5

    if is_moving:
        # Assume updates come roughly every second
        conn.execute(
            "UPDATE walk_sessions SET moving_seconds = moving_seconds + 1, distance_m = distance_m + ? WHERE walk_id = ?",
            (update.speed_mps, update.walk_id),
        )
    else:
        conn.execute(
            "UPDATE walk_sessions SET still_seconds = still_seconds + 1 WHERE walk_id = ?",
            (update.walk_id,),
        )

    conn.commit()
    conn.close()

    return {"moving": is_moving, "speed_mps": update.speed_mps}


# ── Story endpoints ───────────────────────────────────────────

@app.post("/api/story/segment")
async def next_segment(req: SegmentRequest):
    """Generate and return the next story segment with audio."""
    conn = get_connection()
    row = conn.execute("SELECT story_id FROM walk_sessions WHERE walk_id = ?", (req.walk_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Walk not found")

    story_id = row["story_id"]
    conn.close()

    story = get_story_state(story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found")

    # Pick an unfound quest to weave into the segment
    unfound = get_unfound_quests(req.walk_id)
    quest_title = unfound[0].title if unfound else ""
    quest_target = unfound[0].target if unfound else ""

    # Every fifth segment, hint at a specific unfound quest
    if story.segment_count > 0 and story.segment_count % 5 == 0 and unfound:
        quest_title = f"{unfound[0].title} (hint: {unfound[0].hint})"

    segment = await generate_segment(story, quest_title, quest_target)

    # Generate TTS audio
    audio_filename = f"{story_id}_seg{segment.segment_number}.wav"
    synthesise(segment.text, audio_filename)
    segment.audio_url = f"/audio/{audio_filename}"

    # Update segment count in walk session
    conn = get_connection()
    conn.execute(
        "UPDATE walk_sessions SET segments_played = segments_played + 1 WHERE walk_id = ?",
        (req.walk_id,),
    )
    conn.commit()
    conn.close()

    return segment


# ── Quest endpoints ───────────────────────────────────────────

@app.get("/api/quests/active")
async def active_quests():
    """Return the currently active quests."""
    quests = get_active_quests()
    return {"quests": [q.model_dump() for q in quests]}


@app.post("/api/quest/find")
async def quest_find(walk_id: str, quest_id: str):
    """Manually mark a quest item as found."""
    record_quest_find(walk_id, quest_id, confirmed=False)
    return {"status": "recorded", "quest_id": quest_id}


@app.get("/api/quest/finds/{walk_id}")
async def walk_finds(walk_id: str):
    """Get all quest finds for a walk."""
    finds = get_walk_quest_finds(walk_id)
    return {"finds": finds}


# ── Photo check endpoint ─────────────────────────────────────

@app.post("/api/photo/check", response_model=PhotoCheckResponse)
async def photo_check(walk_id: str, quest_id: str, photo: UploadFile = File(...)):
    """Upload a photo and check it against a quest target."""
    # Save the uploaded photo
    photo_path = PHOTO_DIR / f"{walk_id}_{quest_id}_{datetime.now().strftime('%H%M%S')}.jpg"
    content = await photo.read()
    with open(photo_path, "wb") as f:
        f.write(content)

    # Look up the quest
    quests = get_active_quests()
    quest = next((q for q in quests if q.id == quest_id), None)
    if quest is None:
        raise HTTPException(status_code=404, detail="Quest not found")

    result = await check_photo(str(photo_path), quest_id, quest.title, quest.target)

    # Record the find
    record_quest_find(walk_id, quest_id, confirmed=result.confirmed, photo_path=str(photo_path))

    return result


# ── Serve the PWA client ──────────────────────────────────────

app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="client")
