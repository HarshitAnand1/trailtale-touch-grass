"""
Trailtale quest engine.
Loads quest packs from JSON, filters by date, and tracks finds.
"""

import json
from pathlib import Path
from datetime import date, datetime
from .models import Quest, QuestPack, QuestFind
from .database import get_connection


QUEST_DIR = Path(__file__).resolve().parent.parent / "data" / "quests"


def load_quest_pack(region: str = "himalayan-foothills") -> QuestPack:
    """Load a quest pack JSON for the given region."""
    path = QUEST_DIR / f"{region}.json"
    if not path.exists():
        raise FileNotFoundError(f"Quest pack not found: {path}")
    with open(path, "r") as f:
        data = json.load(f)
    return QuestPack(**data)


def get_active_quests(region: str = "himalayan-foothills", on_date: date | None = None) -> list[Quest]:
    """Return quests that are active on the given date (defaults to today)."""
    if on_date is None:
        on_date = date.today()
    pack = load_quest_pack(region)
    return [q for q in pack.quests if q.starts <= on_date <= q.expires]


def get_expired_quests(region: str = "himalayan-foothills", on_date: date | None = None) -> list[Quest]:
    """Return quests whose expiry date has passed."""
    if on_date is None:
        on_date = date.today()
    pack = load_quest_pack(region)
    return [q for q in pack.quests if q.expires < on_date]


def record_quest_find(walk_id: str, quest_id: str, confirmed: bool = False, photo_path: str | None = None):
    """Record that a quest item was found during a walk."""
    conn = get_connection()
    conn.execute(
        """INSERT INTO quest_finds (walk_id, quest_id, found_at, photo_path, confirmed)
           VALUES (?, ?, ?, ?, ?)""",
        (walk_id, quest_id, datetime.now().isoformat(), photo_path, int(confirmed))
    )
    conn.commit()
    conn.close()


def get_walk_quest_finds(walk_id: str) -> list[dict]:
    """Return all quest finds for a given walk."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT quest_id, found_at, confirmed FROM quest_finds WHERE walk_id = ?",
        (walk_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_unfound_quests(walk_id: str, region: str = "himalayan-foothills") -> list[Quest]:
    """Return active quests that have NOT been found yet during this walk."""
    active = get_active_quests(region)
    found_ids = {f["quest_id"] for f in get_walk_quest_finds(walk_id)}
    return [q for q in active if q.id not in found_ids]
