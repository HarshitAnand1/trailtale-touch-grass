"""
Trailtale story engine.
Generates story segments using a local LLM (Gemma via llama.cpp server).
Implements the segment loop and prompt template from the design doc.
"""

import httpx
import logging
from datetime import datetime
from .models import StoryState, StorySegment
from .database import get_connection

logger = logging.getLogger("trailtale.story")

# llama.cpp server endpoint (default)
LLAMA_CPP_URL = "http://127.0.0.1:8080/completion"

# ── Prompt template (from the design doc) ─────────────────────

SEGMENT_PROMPT = """You write one segment of an audio story for someone walking outside.
Genre: {genre}
Story so far: {summary_so_far}
Last segment: {last_segment}
Time of day: {time_of_day}. Season: {season}.
Active quest: {quest_title}. Work one natural mention of {quest_target} into the segment.
Rules:
- 60 to 90 words. Plain words. No lists.
- End on a small question or a sound, so the walker wants the next segment.
- Never tell the walker to leave the path, climb, cross water, or hurry.
- Do not name real people or places."""

SUMMARY_PROMPT = """Summarise this story segment in one sentence, fifteen words or fewer.

Segment: {segment_text}

Summary:"""


def _get_time_of_day() -> str:
    """Return a human-readable time-of-day label."""
    hour = datetime.now().hour
    if hour < 6:
        return "pre-dawn"
    elif hour < 10:
        return "early morning"
    elif hour < 12:
        return "late morning"
    elif hour < 14:
        return "midday"
    elif hour < 17:
        return "afternoon"
    elif hour < 20:
        return "evening"
    else:
        return "night"


def _get_season() -> str:
    """Return the current season based on the month."""
    month = datetime.now().month
    if month in (3, 4, 5):
        return "spring"
    elif month in (6, 7, 8):
        return "summer"
    elif month in (9, 10, 11):
        return "autumn"
    else:
        return "winter"


def build_segment_prompt(story: StoryState, quest_title: str = "", quest_target: str = "") -> str:
    """Build the prompt for one story segment."""
    return SEGMENT_PROMPT.format(
        genre=story.genre,
        summary_so_far=story.summary_so_far or "The story has just begun.",
        last_segment=story.last_segment or "None yet — this is the opening.",
        time_of_day=_get_time_of_day(),
        season=_get_season(),
        quest_title=quest_title or "no active quest",
        quest_target=quest_target or "the natural surroundings",
    )


async def call_llm(prompt: str, max_tokens: int = 200) -> str:
    """Call the llama.cpp /completion endpoint."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                LLAMA_CPP_URL,
                json={
                    "prompt": prompt,
                    "n_predict": max_tokens,
                    "temperature": 0.8,
                    "top_p": 0.9,
                    "stop": ["\n\n", "---"],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("content", "").strip()
    except Exception as e:
        logger.error("LLM call failed: %s", e)
        # Fallback: return a placeholder segment so the walk doesn't break
        return (
            "The trail curved gently ahead. Somewhere off to the left, "
            "a branch cracked—too heavy for the wind. You listened, "
            "but heard only the stream below. What made that sound?"
        )


async def generate_segment(story: StoryState, quest_title: str = "", quest_target: str = "") -> StorySegment:
    """Generate the next story segment and update the story state."""
    prompt = build_segment_prompt(story, quest_title, quest_target)
    text = await call_llm(prompt)

    # Get a one-line summary of the new segment
    summary_prompt = SUMMARY_PROMPT.format(segment_text=text)
    new_summary = await call_llm(summary_prompt, max_tokens=40)
    if not new_summary:
        new_summary = text[:80]

    # Update story state
    story.last_segment = text
    story.summary_so_far = new_summary
    story.segment_count += 1

    # Persist to database
    save_story_state(story)

    return StorySegment(
        text=text,
        segment_number=story.segment_count,
    )


def create_story(genre: str = "mystery") -> StoryState:
    """Create a new story and persist it."""
    story_id = f"story-{datetime.now().strftime('%m%d%H%M')}"
    story = StoryState(story_id=story_id, genre=genre)

    conn = get_connection()
    conn.execute(
        """INSERT INTO story_state (story_id, genre, summary_so_far, last_segment, segment_count)
           VALUES (?, ?, ?, ?, ?)""",
        (story.story_id, story.genre, story.summary_so_far, story.last_segment, story.segment_count),
    )
    conn.commit()
    conn.close()
    return story


def get_story_state(story_id: str) -> StoryState | None:
    """Load story state from the database."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM story_state WHERE story_id = ?", (story_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return StoryState(**dict(row))


def save_story_state(story: StoryState):
    """Persist updated story state."""
    conn = get_connection()
    conn.execute(
        """UPDATE story_state
           SET genre = ?, summary_so_far = ?, last_segment = ?, segment_count = ?
           WHERE story_id = ?""",
        (story.genre, story.summary_so_far, story.last_segment, story.segment_count, story.story_id),
    )
    conn.commit()
    conn.close()
