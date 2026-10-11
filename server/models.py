"""
Trailtale data models.
Pydantic models for walk sessions, story state, quests, and API requests/responses.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, date


# ── Quest models ──────────────────────────────────────────────

class Quest(BaseModel):
    id: str
    title: str
    target: str
    count: int = 1
    starts: date
    expires: date
    hint: str = ""


class QuestPack(BaseModel):
    region: str
    version: str
    quests: list[Quest]


class QuestFind(BaseModel):
    quest_id: str
    found_at: str
    confirmed: bool = False


# ── Story models ──────────────────────────────────────────────

class StoryState(BaseModel):
    story_id: str
    genre: str = "mystery"
    summary_so_far: str = ""
    last_segment: str = ""
    segment_count: int = 0


class StorySegment(BaseModel):
    text: str
    audio_url: Optional[str] = None
    segment_number: int = 0


# ── Walk models ───────────────────────────────────────────────

class WalkSession(BaseModel):
    walk_id: str
    started_at: str
    ended_at: Optional[str] = None
    moving_seconds: int = 0
    still_seconds: int = 0
    distance_m: float = 0.0
    quests_found: list[str] = Field(default_factory=list)
    story_id: Optional[str] = None
    segments_played: int = 0
    status: str = "active"


class WalkLog(BaseModel):
    walk_id: str
    distance_m: float
    moving_minutes: float
    still_minutes: float
    quests_found: list[str]
    story_title: str
    segments_played: int
    markdown: str


# ── API request / response models ────────────────────────────

class StartWalkRequest(BaseModel):
    genre: str = "mystery"


class StartWalkResponse(BaseModel):
    walk_id: str
    story_id: str
    quests: list[Quest]


class EndWalkResponse(BaseModel):
    walk_log: WalkLog


class MotionUpdate(BaseModel):
    walk_id: str
    speed_mps: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timestamp: str


class SegmentRequest(BaseModel):
    walk_id: str


class PhotoCheckRequest(BaseModel):
    walk_id: str
    quest_id: str


class PhotoCheckResponse(BaseModel):
    confirmed: bool
    reason: str
