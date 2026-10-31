/**
 * Exécution capturée d'une commande du gate, hors du démon.
 *
 * Le démon réutilise un seul processus pour toutes les requêtes : il remplace
 * `process.stdout.write` et lit `process.exitCode` pour reproduire le contrat
 * d'un lancement one-shot. La restauration doit avoir lieu **même quand la
 * commande lève** — sinon un code 2 laissé en place fait passer toutes les
 * réponses suivantes pour des refus. Constaté le 2026-10-31 : le gate
 * annonçait « Blocked by rule, not by a missing skill » sans nommer aucune
 * skill ni aucune raison, et refusait toute écriture, y compris hors dépôt.
 *
 * Sorti dans son propre module pour être testable : importer le démon
 * attacherait les écouteurs de `process.stdin` et garderait le processus de
 * test en vie.
 */

type WriteLike = (chunk: unknown, ...rest: unknown[]) => boolean;

export type Captured = { stdout: string; stderr: string; status: number };

export function capture(fn: () => void): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const previousExit = process.exitCode;
  process.exitCode = 0;

  const captureWrite =
    (sink: string[]): WriteLike =>
    (chunk: unknown): boolean => {
      sink.push(String(chunk));
      return true;
    };

  const stdoutStream = process.stdout as unknown as { write: typeof process.stdout.write };
  const stderrStream = process.stderr as unknown as { write: typeof process.stderr.write };
  stdoutStream.write = captureWrite(out) as unknown as typeof process.stdout.write;
  stderrStream.write = captureWrite(err) as unknown as typeof process.stderr.write;

  let status = 0;
  try {
    fn();
  } finally {
    stdoutStream.write = realOut;
    stderrStream.write = realErr;
    status = typeof process.exitCode === "number" ? process.exitCode : 0;
    process.exitCode = previousExit;
  }

  return { stdout: out.join(""), stderr: err.join(""), status };
}
