#!/usr/bin/env python3
"""Génère des analyses et statistiques pour Novahiz."""

import sqlite3
import csv
import sys
from pathlib import Path
from datetime import datetime, timedelta

def run_analytics(db_path: Path):
    if not db_path.exists():
        print(f"Erreur: Base de données non trouvée: {db_path}")
        return

    db = sqlite3.connect(str(db_path))
    
    print("=== Novahiz Analytics ===\n")
    
    # Statistiques par catégorie de requête
    print("1. Distribution des requêtes par catégorie")
    rows = db.execute(
        """SELECT request_category, COUNT(*) as cnt 
           FROM sessions WHERE request_category IS NOT NULL 
           GROUP BY request_category ORDER BY cnt DESC"""
    ).fetchall()
    for cat, cnt in rows:
        print(f"  - {cat or 'N/A'}: {cnt}")
        
    # Taux de succès du gate
    print("\n2. Taux de succès du Gate (Historique)")
    total = db.execute("SELECT COUNT(*) FROM compliance_log").fetchone()[0]
    if total > 0:
        passed = db.execute("SELECT COUNT(*) FROM compliance_log WHERE status = 'pass'").fetchone()[0]
        failed = db.execute("SELECT COUNT(*) FROM compliance_log WHERE status = 'fail'").fetchone()[0]
        blocked = db.execute("SELECT COUNT(*) FROM compliance_log WHERE status = 'block'").fetchone()[0]
        print(f"  - Total vérifications: {total}")
        print(f"  - Pass: {passed} ({passed/total*100:.1f}%)")
        print(f"  - Fail: {failed} ({failed/total*100:.1f}%)")
        print(f"  - Block: {blocked} ({blocked/total*100:.1f}%)")
    else:
        print("  - Aucune donnée de compliance.")

    db.close()

if __name__ == "__main__":
    db_path = Path.home() / ".gemini" / "config" / "novahiz.db"
    run_analytics(db_path)
