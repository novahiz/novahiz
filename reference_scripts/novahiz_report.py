#!/usr/bin/env python3
"""Génère un rapport Markdown de compliance novahiz."""

import sqlite3
from pathlib import Path
from datetime import datetime, timedelta

def generate_report(db_path: Path, days: int = 7) -> str:
    db = sqlite3.connect(str(db_path))
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()

    lines = [f"# Rapport Novahiz — {days} derniers jours\n"]

    # Vue d'ensemble
    total_row = db.execute(
        "SELECT COUNT(*) FROM compliance_log WHERE timestamp > ?", (cutoff,)
    ).fetchone()
    total = total_row[0] if total_row else 0
    
    passed_row = db.execute(
        "SELECT COUNT(*) FROM compliance_log WHERE timestamp > ? AND status = 'pass'",
        (cutoff,)
    ).fetchone()
    passed = passed_row[0] if passed_row else 0
    
    failed_row = db.execute(
        "SELECT COUNT(*) FROM compliance_log WHERE timestamp > ? AND status = 'fail'",
        (cutoff,)
    ).fetchone()
    failed = failed_row[0] if failed_row else 0

    rate = (passed / total * 100) if total > 0 else 0
    lines.append(f"## Vue d'ensemble")
    lines.append(f"- Total checks : {total}")
    lines.append(f"- Passés : {passed} ({rate:.1f}%)")
    lines.append(f"- Échoués : {failed}\n")

    # Top violations
    lines.append("## Top violations")
    rows = db.execute(
        """SELECT rule, COUNT(*) as cnt FROM compliance_log
           WHERE timestamp > ? AND status = 'fail'
           GROUP BY rule ORDER BY cnt DESC LIMIT 5""",
        (cutoff,)
    ).fetchall()
    
    if not rows:
        lines.append("- Aucune violation détectée.")
    else:
        for rule, cnt in rows:
            lines.append(f"- `{rule}` : {cnt} fois")

    # Sessions actives
    lines.append("\n## Sessions récentes")
    rows = db.execute(
        """SELECT session_id, request_category, gate_passed, mutation_count
           FROM sessions WHERE last_activity > ?
           ORDER BY last_activity DESC LIMIT 10""",
        (cutoff,)
    ).fetchall()
    
    if not rows:
        lines.append("- Aucune session récente.")
    else:
        for sid, cat, gate, mutations in rows:
            status = "PASS" if gate else "FAIL"
            lines.append(f"- [{status}] {sid[:12]}... | {cat or 'N/A'} | {mutations} mutations")

    db.close()
    return "\n".join(lines)

if __name__ == "__main__":
    db_path = Path.home() / ".gemini" / "config" / "novahiz.db"
    if db_path.exists():
        report = generate_report(db_path)
        print(report)
    else:
        print(f"Base de données non trouvée: {db_path}")
        print("Veuillez d'abord exécuter novahiz_migrate.py")
