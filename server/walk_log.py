"""
Trailtale walk log.
Generates a walk summary as Markdown and stores it in SQLite.
"""

from datetime import datetime
from .models import WalkLog
from .database import get_connection
from .quest_engine import get_walk_quest_finds


def generate_walk_log(walk_id: str) -> WalkLog:
    """Build a walk log from the session data and quest finds."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM walk_sessions WHERE walk_id = ?", (walk_id,)).fetchone()
    if row is None:
        conn.close()
        raise ValueError(f"Walk not found: {walk_id}")
    session = dict(row)

    # Get story info
    story_row = conn.execute(
        "SELECT * FROM story_state WHERE story_id = ?", (session.get("story_id", ""),)
    ).fetchone()
    conn.close()

    story_title = "Untitled"
    if story_row:
        story_data = dict(story_row)
        story_title = f"{story_data['genre'].title()} — {story_data['story_id']}"

    # Get quest finds for this walk
    finds = get_walk_quest_finds(walk_id)
    quest_ids = [f["quest_id"] for f in finds]

    moving_min = round(session["moving_seconds"] / 60, 1)
    still_min = round(session["still_seconds"] / 60, 1)
    distance = round(session["distance_m"], 0)

    # Build the markdown log
    md_lines = [
        f"# Walk Log — {walk_id}",
        "",
        f"**Date:** {session['started_at'][:10]}",
        f"**Started:** {session['started_at']}",
        f"**Ended:** {session.get('ended_at', 'in progress')}",
        "",
        "## Stats",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Distance | {distance} m |",
        f"| Moving time | {moving_min} min |",
        f"| Still time | {still_min} min |",
        f"| Total time | {round(moving_min + still_min, 1)} min |",
        f"| Segments played | {session['segments_played']} |",
        "",
        "## Story",
        "",
        f"**Title:** {story_title}",
        "",
        "## Quests Found",
        "",
    ]

    if quest_ids:
        for qid in quest_ids:
            confirmed = any(f["quest_id"] == qid and f["confirmed"] for f in finds)
            icon = "✅" if confirmed else "📷"
            md_lines.append(f"- {icon} {qid}")
    else:
        md_lines.append("- None this walk")

    md_lines.append("")
    markdown = "\n".join(md_lines)

    # Save to database
    conn = get_connection()
    conn.execute(
        """INSERT OR REPLACE INTO walk_logs (walk_id, log_markdown, created_at)
           VALUES (?, ?, ?)""",
        (walk_id, markdown, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()

    return WalkLog(
        walk_id=walk_id,
        distance_m=session["distance_m"],
        moving_minutes=moving_min,
        still_minutes=still_min,
        quests_found=quest_ids,
        story_title=story_title,
        segments_played=session["segments_played"],
        markdown=markdown,
    )
