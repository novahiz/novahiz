/**
 * Lignée de sessions : qui a lancé qui.
 *
 * Un sous-agent ouvre sa propre session, avec son propre identifiant, dans le
 * même arbre de travail. Sans lien, le gate le traite comme un inconnu : avec
 * `claims.required`, chaque édition du sous-agent est refusée parce qu'il ne
 * détient aucun claim — alors que son parent, lui, en détient un sur les mêmes
 * fichiers. La lignée répare les deux côtés : un enfant hérite des claims de
 * ses ancêtres, et un parent ne se voit pas lui-même comme un concurrent.
 *
 * Le lien est enregistré par l'adaptateur au moment où il observe un appel de
 * délégation, pas deviné à partir du nom de la session.
 */
import type { DatabaseSync } from "./db.ts";

/** Profondeur maximale explorée : une chaîne de délégations reste courte. */
const MAX_DEPTH = 8;

type LinkRow = { child_id: string; parent_id: string; created_at: string };

/** Enregistre (ou rafraîchit) le lien parent → enfant. */
export function recordSessionLink(
  db: DatabaseSync,
  input: { child: string; parent: string },
): { recorded: boolean; reason?: string } {
  const child = input.child.trim();
  const parent = input.parent.trim();
  if (child.length === 0 || parent.length === 0) return { recorded: false, reason: "identifiant vide" };
  if (child === parent) return { recorded: false, reason: "une session ne peut pas être son propre parent" };

  db.prepare(
    `INSERT INTO session_links (child_id, parent_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(child_id) DO UPDATE SET parent_id = excluded.parent_id, created_at = excluded.created_at`,
  ).run(child, parent, new Date().toISOString());

  return { recorded: true };
}

export function parentOf(db: DatabaseSync, session: string): string | null {
  const row = db
    .prepare("SELECT parent_id FROM session_links WHERE child_id = ?")
    .get(session.trim()) as Pick<LinkRow, "parent_id"> | undefined;
  return row?.parent_id ?? null;
}

function ancestorsOf(db: DatabaseSync, session: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([session]);
  let current = parentOf(db, session);

  while (current && !seen.has(current) && chain.length < MAX_DEPTH) {
    chain.push(current);
    seen.add(current);
    current = parentOf(db, current);
  }

  return chain;
}

function descendantsOf(db: DatabaseSync, session: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([session]);
  let frontier = [session];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const placeholders = frontier.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT child_id FROM session_links WHERE parent_id IN (${placeholders})`)
      .all(...frontier) as { child_id: string }[];
    frontier = [];
    for (const row of rows) {
      if (seen.has(row.child_id)) continue;
      seen.add(row.child_id);
      found.push(row.child_id);
      frontier.push(row.child_id);
    }
  }

  return found;
}

/**
 * La famille d'une session : elle-même, ses ancêtres et ses descendants.
 *
 * Sert à deux décisions : un claim détenu par un membre de la famille compte
 * comme le sien, et un membre de la famille n'est pas une « autre session
 * vivante » sur le projet.
 */
export function sessionFamily(db: DatabaseSync, session: string): Set<string> {
  const id = session.trim();
  if (id.length === 0) return new Set();
  return new Set([id, ...ancestorsOf(db, id), ...descendantsOf(db, id)]);
}
