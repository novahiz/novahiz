#!/usr/bin/env python3
"""Exportateur de statistiques JSON ultra-rapide pour le Dashboard Next.js."""

import json
import sqlite3
from pathlib import Path
from datetime import datetime

def get_stats():
    config_dir = Path.home() / ".gemini" / "config"
    db_path = config_dir / "novahiz.db"
    session_state_path = config_dir / "novahiz-session-state.json"
    compliance_path = config_dir / "novahiz-compliance.json"

    # Ensure DB exists
    config_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(db_path), timeout=5.0)
    db.execute("PRAGMA journal_mode = WAL;")
    db.execute("PRAGMA busy_timeout = 5000;")
    db.execute("PRAGMA synchronous = NORMAL;")

    # Ensure tables
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
    """)

    # Sync live JSON state if present
    if session_state_path.exists():
        try:
            with open(session_state_path, 'r', encoding='utf-8') as f:
                state_data = json.load(f)
                for sid, state in state_data.items():
                    db.execute(
                        """INSERT OR REPLACE INTO sessions
                           (session_id, started_at, last_activity, request_category,
                            gate_passed, gate_passed_at, todo_exists, browser_used,
                            skills_loaded, files_modified, mutation_count, memory_writes_detected)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (sid, state.get('startedAt', ''), state.get('lastActivity', ''),
                         state.get('requestCategory', 'Général'), state.get('gatePassed', False),
                         state.get('gatePassedAt'), state.get('todoExists', False),
                         state.get('browserUsed', False),
                         json.dumps(state.get('skillsLoaded', [])),
                         json.dumps(state.get('filesModified', [])),
                         state.get('mutationCount', 0),
                         state.get('memoryWritesDetected', 0))
                    )
                db.commit()
        except Exception:
            pass

    # Query sessions
    cur = db.cursor()
    cur.execute("SELECT * FROM sessions ORDER BY last_activity DESC LIMIT 50")
    cols = [col[0] for col in cur.description]
    sessions_rows = [dict(zip(cols, row)) for row in cur.fetchall()]

    total_sessions = len(sessions_rows)
    gate_passed_sessions = sum(1 for s in sessions_rows if s.get('gate_passed'))
    gate_compliance_rate = int((gate_passed_sessions / total_sessions) * 100) if total_sessions > 0 else 100
    total_mutations = sum(s.get('mutation_count', 0) for s in sessions_rows)

    # Categories distribution
    ALL_CATEGORIES = [
      'Général', 'Frontend UI', 'Backend API', 'Database SQL',
      'Mobile Expo', 'DevSecOps & CI', 'Testing & QA', 'Architecture & Refactor',
      'Observability', 'Security Audit', 'Data Engineering', 'Sciences / Bio', 'Performance & Fix'
    ]
    category_counts = {cat: 0 for cat in ALL_CATEGORIES}
    for s in sessions_rows:
        cat = s.get('request_category') or 'Général'
        category_counts[cat] = category_counts.get(cat, 0) + 1

    category_data = [{"name": k, "value": v} for k, v in category_counts.items()]

    # Query compliance logs
    cur.execute("SELECT * FROM compliance_log ORDER BY id DESC LIMIT 50")
    l_cols = [col[0] for col in cur.description]
    logs_rows = [dict(zip(l_cols, row)) for row in cur.fetchall()]

    total_logs = len(logs_rows)
    passed_logs = sum(1 for l in logs_rows if l.get('status') == 'PASS')
    failed_logs = sum(1 for l in logs_rows if l.get('status') == 'FAIL')
    log_compliance_rate = int((passed_logs / total_logs) * 100) if total_logs > 0 else 100

    timeline_data = [
        {
            "name": s['session_id'][:6],
            "mutations": s.get('mutation_count', 0),
            "gate": 100 if s.get('gate_passed') else 0
        }
        for s in reversed(sessions_rows[:10])
    ]

    for s in sessions_rows:
        try:
            s['skills_loaded'] = json.loads(s.get('skills_loaded') or '[]')
        except:
            s['skills_loaded'] = []
        try:
            s['files_modified'] = json.loads(s.get('files_modified') or '[]')
        except:
            s['files_modified'] = []

    db.close()

    return {
        "success": True,
        "timestamp": datetime.now().isoformat(),
        "metrics": {
            "totalSessions": total_sessions,
            "gatePassedSessions": gate_passed_sessions,
            "gateComplianceRate": gate_compliance_rate,
            "totalMutations": total_mutations,
            "totalLogs": total_logs,
            "passedLogs": passed_logs,
            "failedLogs": failed_logs,
            "logComplianceRate": log_compliance_rate
        },
        "categoryData": category_data,
        "timelineData": timeline_data,
        "recentSessions": sessions_rows,
        "recentLogs": logs_rows
    }

if __name__ == "__main__":
    print(json.dumps(get_stats()))
