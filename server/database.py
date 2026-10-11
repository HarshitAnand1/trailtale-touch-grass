"""
Trailtale database layer.
SQLite for walk sessions, story state, and quest finds.
"""

import sqlite3
import os
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DB_DIR / "trailtale.db"


def get_connection() -> sqlite3.Connection:
    """Return a connection to the SQLite database, creating it if needed."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create tables if they do not exist."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS walk_sessions (
            walk_id         TEXT PRIMARY KEY,
            started_at      TEXT NOT NULL,
            ended_at        TEXT,
            moving_seconds  INTEGER DEFAULT 0,
            still_seconds   INTEGER DEFAULT 0,
            distance_m      REAL DEFAULT 0,
            story_id        TEXT,
            segments_played INTEGER DEFAULT 0,
            status          TEXT DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS story_state (
            story_id        TEXT PRIMARY KEY,
            genre           TEXT NOT NULL DEFAULT 'mystery',
            summary_so_far  TEXT DEFAULT '',
            last_segment    TEXT DEFAULT '',
            segment_count   INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS quest_finds (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            walk_id         TEXT NOT NULL,
            quest_id        TEXT NOT NULL,
            found_at        TEXT NOT NULL,
            photo_path      TEXT,
            confirmed       INTEGER DEFAULT 0,
            FOREIGN KEY (walk_id) REFERENCES walk_sessions(walk_id)
        );

        CREATE TABLE IF NOT EXISTS walk_logs (
            walk_id         TEXT PRIMARY KEY,
            log_markdown    TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (walk_id) REFERENCES walk_sessions(walk_id)
        );
    """)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Database initialised at {DB_PATH}")
