#!/usr/bin/env python3
"""CLI pour interroger la base de données de compliance Novahiz."""

import sqlite3
import argparse
from pathlib import Path

def print_session_audit(db_path: Path, session_id: str):
    if not db_path.exists():
        print(f"Erreur: Base de données non trouvée: {db_path}")
        return

    db = sqlite3.connect(str(db_path))
    
    session = db.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    if not session:
        print(f"Session introuvable: {session_id}")
        return
        
    print(f"=== Audit de la session: {session_id} ===")
    
    # 0=session_id, 1=started_at, 2=last_activity, 3=request_category, 4=gate_passed, 5=gate_passed_at
    # 6=todo_exists, 7=browser_used, 8=skills_loaded, 9=files_modified, 10=mutation_count, 11=memory_writes
    print(f"Catégorie       : {session[3]}")
    print(f"Gate Passed     : {'Oui' if session[4] else 'Non'}")
    print(f"Mutations       : {session[10]}")
    print(f"Écritures Mém.  : {session[11]}")
    
    print("\nLogs de compliance pour cette session :")
    logs = db.execute(
        "SELECT timestamp, rule, status, detail FROM compliance_log WHERE session_id = ? ORDER BY timestamp",
        (session_id,)
    ).fetchall()
    
    for ts, rule, status, detail in logs:
        print(f"[{ts}] {rule} : {status} (Détail: {detail})")
        
    db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Audit CLI Novahiz")
    parser.add_argument("session_id", help="L'ID de la session à auditer")
    args = parser.parse_args()
    
    db_path = Path.home() / ".gemini" / "config" / "novahiz.db"
    print_session_audit(db_path, args.session_id)
