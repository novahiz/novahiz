#!/usr/bin/env python3
"""Migre les données JSON novahiz vers SQLite."""

import json
import sqlite3
from pathlib import Path
from datetime import datetime
import os

def migrate_compliance(db: sqlite3.Connection, json_path: Path):
    """Migre novahiz-compliance.json → table compliance_log."""
    if not json_path.exists():
        return 0

    count = 0
    with open(json_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                db.execute(
                    """INSERT INTO compliance_log
                       (timestamp, session_id, rule, status, tool, detail)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (entry.get('timestamp', datetime.now().isoformat()), 
                     entry.get('sessionID', 'unknown'), 
                     entry.get('rule', 'unknown'),
                     entry.get('status', 'unknown'), 
                     entry.get('tool'), 
                     entry.get('detail'))
                )
                count += 1
            except json.JSONDecodeError:
                pass

    db.commit()
    return count

def migrate_sessions(db: sqlite3.Connection, state_path: Path):
    """Migre novahiz-session-state.json → table sessions."""
    if not state_path.exists():
        return 0

    with open(state_path, 'r', encoding='utf-8') as f:
        try:
            sessions = json.load(f)
        except json.JSONDecodeError:
            return 0

    count = 0
    for sid, state in sessions.items():
        db.execute(
            """INSERT OR REPLACE INTO sessions
               (session_id, started_at, last_activity, request_category,
                gate_passed, gate_passed_at, todo_exists, browser_used,
                skills_loaded, files_modified, mutation_count, memory_writes_detected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sid, state.get('startedAt', ''), state.get('lastActivity', ''),
             state.get('requestCategory'), state.get('gatePassed', False),
             state.get('gatePassedAt'), state.get('todoExists', False),
             state.get('browserUsed', False),
             json.dumps(state.get('skillsLoaded', [])),
             json.dumps(state.get('filesModified', [])),
             state.get('mutationCount', 0),
             state.get('memoryWritesDetected', 0))
        )
        count += 1

    db.commit()
    return count

def main():
    config_dir = Path.home() / ".gemini" / "config"
    db_path = config_dir / "novahiz.db"
    
    # Create config dir if it doesn't exist
    config_dir.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(str(db_path), timeout=30.0)
    # Enterprise-grade concurrency pragmas
    db.execute("PRAGMA journal_mode = WAL;")
    db.execute("PRAGMA busy_timeout = 5000;")
    db.execute("PRAGMA synchronous = NORMAL;")
    db.execute("PRAGMA foreign_keys = ON;")
    
    db.executescript("""
        CREATE TABLE IF NOT EXISTS compliance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            session_id TEXT NOT NULL,
            rule TEXT NOT NULL,
            status TEXT NOT NULL,
            tool TEXT,
            detail TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            started_at TEXT NOT NULL,
            last_activity TEXT,
            request_category TEXT,
            gate_passed BOOLEAN DEFAULT 0,
            gate_passed_at TEXT,
            todo_exists BOOLEAN DEFAULT 0,
            browser_used BOOLEAN DEFAULT 0,
            skills_loaded TEXT,
            files_modified TEXT,
            mutation_count INTEGER DEFAULT 0,
            memory_writes_detected INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','cancelled')),
            priority TEXT CHECK(priority IN ('high','medium','low')),
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        );
        CREATE TABLE IF NOT EXISTS memory_buffer (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN ('major','minor','config','trivial')),
            content TEXT NOT NULL,
            flushed BOOLEAN DEFAULT 0,
            flushed_at TEXT,
            created_at TEXT NOT NULL
        );
    """)

    n_compliance = migrate_compliance(db, config_dir / "novahiz-compliance.json")
    n_sessions = migrate_sessions(db, config_dir / "novahiz-session-state.json")

    print(f"Migration terminée : {n_compliance} logs, {n_sessions} sessions")
    print(f"Base de données : {db_path}")

    db.close()

if __name__ == "__main__":
    main()
