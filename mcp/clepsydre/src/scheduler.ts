// clepsydre — ordonnanceur. Un seul reveil a la fois, calibre sur une
// echeance absolue : aucun setInterval cumulatif, donc aucune derive quand la
// machine est chargee. Le timer est plafonne sous 2^31-1 ms (setTimeout
// tronque au-dela) et libere a l'arret.
//
// Politique de rattrapage (mode veille, process arrete) :
//   run-once (defaut)  une execution de rattrapage au reveil, puis calendrier normal
//   skip               rien n'est rattrape, le calendrier repart de maintenant
//   run-all            les occurrences manquees sont rejouees, plafeonnes
// Une occurrence plus ancienne que `catchUpThresholdMs` (60 s par defaut)
// bascule toujours en traitement special : une tache n'execute jamais deux
// fois en parallele (verrou `busy`), meme si la cadence est plus rapide que
// la duree de l'execution.
// Le verrou ne s'arme jamais : `arm()` ignore les taches busy, sinon une
// echeance passee donnerait un timer 0 ms en boucle (`skip -> arm`) pendant
// toute l'execution ; la liberation re-evalue les echeances et rattrape
// l'occurrence due une seule fois.

import { appendExecution, findTask, loadTasks, mutateTasks, newId, saveTasks, type Task } from "./store.ts";
import { nextRun, parseSchedule, type Schedule } from "./cron.ts";

export type CatchUp = "run-once" | "skip" | "run-all";

/** setTimeout refuse les delais >= 2^31 ms : au-dela, il faudrait un second
 *  reveil intermediaire. Marge de 1 s pour absorber le temps de traitement. */
export const MAX_TIMER_MS = 2_147_483_646;

export interface RunContext {
  trigger: "schedule" | "manual";
  /** Instant theorique du declenchement (ISO), null pour un declenchement manuel. */
  scheduledFor: string | null;
}

export type RunFn = (task: Task, context: RunContext) => Promise<unknown>;

export interface SchedulerOptions {
  /** Dossier de donnees (defaut : CLEPSYDRE_HOME ou ~/.novahiz/clepsydre). */
  dir?: string;
  run: RunFn;
  now?: () => number;
  catchUp?: CatchUp;
  catchUpThresholdMs?: number;
  maxCatchUpRuns?: number;
}

export interface TriggerOutcome {
  ok: boolean;
  reason?: string;
}

function parseSafely(task: Task): Schedule | null {
  if (!task.schedule) return null;
  try {
    return parseSchedule(task.schedule);
  } catch {
    // Expression cassee sauvegardee a la main : la tache reste listee, mais
    // elle ne se planifie pas. L'outil update renvoie l'erreur au modele.
    return null;
  }
}

export class Scheduler {
  private readonly dir: string | undefined;
  private readonly run: RunFn;
  private readonly nowFn: () => number;
  private readonly catchUp: CatchUp;
  private readonly threshold: number;
  private readonly maxCatchUp: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly busy = new Set<string>();

  constructor(options: SchedulerOptions) {
    this.dir = options.dir;
    this.run = options.run;
    this.nowFn = options.now ?? (() => Date.now());
    this.catchUp = options.catchUp ?? "run-once";
    this.threshold = options.catchUpThresholdMs ?? 60_000;
    this.maxCatchUp = options.maxCatchUpRuns ?? 10;
  }

  /** Identifiants des tâches en cours d'exécution (verrou anti-chevauchement). */
  busyTaskIds(): string[] {
    return Array.from(this.busy);
  }

  private now(): number {
    return this.nowFn();
  }

  /** Le modele persiste des ISO lisibles ; l'ordonnanceur calcule en ms.
   *  Une echeance illisible (edition manuelle) vaut null : pas de
   *  planification, pas de crash. */
  private dueMs(task: Task): number | null {
    if (task.nextRunAt === null) return null;
    const ms = Date.parse(task.nextRunAt);
    return Number.isNaN(ms) ? null : ms;
  }

  private stamp(ms: number | null): string | null {
    return ms === null ? null : new Date(ms).toISOString();
  }

  private computeNext(task: Task, afterMs: number): string | null {
    const schedule = parseSafely(task);
    if (!schedule) return null;
    const tz = task.timezone && task.timezone.length > 0 ? task.timezone : undefined;
    try {
      return this.stamp(nextRun(schedule, afterMs, tz));
    } catch {
      // Fuseau inconnu saisi a la main : pas de planification, pas de crash.
      return null;
    }
  }

  /** Recalcule les `nextRunAt` manquants. Forcer `nextRunAt = null` sur une
   *  tache avant d'appeler cette methode force son recalcul (changement
   *  d'expression ou de fuseau). */
  refresh(): void {
    const now = this.now();
    mutateTasks((tasks) => {
      for (const task of tasks) {
        if (!task.enabled || !task.schedule) {
          task.nextRunAt = null;
          continue;
        }
        if (task.nextRunAt === null) task.nextRunAt = this.computeNext(task, now);
      }
    }, this.dir);
  }

  /** Arme le prochain reveil sur l'echeance la plus proche.
   *  Une tache en execution (verrou `busy`) est ignoree : son echeance passe
   *  reste en file jusqu'a la liberation, et un reveil dessus ne ferait que
   *  boucler (`timer 0 ms -> wake -> skip -> arm`) pendant toute
   *  l'execution, a coup de lecture disque. Le reveil de liberation
   *  (`release`) re-evalue les echeances quand le verrou saute.
   *  Retourne le delai retenu (null : aucune tache a armer), pour test. */
  arm(): number | null {
    this.stopTimer();
    const now = this.now();
    const { tasks } = loadTasks(this.dir);
    let earliest: number | null = null;
    for (const task of tasks) {
      if (!task.enabled || !task.schedule) continue;
      if (this.busy.has(task.id)) continue;
      const due = this.dueMs(task);
      if (due === null) continue;
      if (earliest === null || due < earliest) earliest = due;
    }
    if (earliest === null) return null;
    const delay = Math.min(Math.max(earliest - now, 0), MAX_TIMER_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.wake();
    }, delay);
    // Le timer ne doit pas maintenir le process en vie : stdin le fait deja.
    this.timer.unref?.();
    return delay;
  }

  /** Demarre l'ordonnanceur : calcule les echeances puis arme le reveil. */
  start(): void {
    this.refresh();
    this.arm();
  }

  stop(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Toutes les occurrences d'une tache entre `from` et `now`, plafonnees. */
  private collect(task: Task, from: number, now: number): number[] {
    const schedule = parseSafely(task);
    const occurrences: number[] = [];
    if (!schedule) return occurrences;
    const tz = task.timezone && task.timezone.length > 0 ? task.timezone : undefined;
    let cursor = from;
    while (cursor <= now && occurrences.length < this.maxCatchUp) {
      occurrences.push(cursor);
      let following: number | null;
      try {
        following = nextRun(schedule, cursor, tz);
      } catch {
        break;
      }
      if (following === null || following <= cursor) break;
      cursor = following;
    }
    return occurrences;
  }

  /** Un reveil : determine ce qui est due, persiste le calendrier, lance. */
  wake(): void {
    this.stopTimer();
    const now = this.now();
    const { tasks } = loadTasks(this.dir);
    const planned: Array<{ task: Task; scheduledFor: number[] }> = [];
    let changed = false;

    for (const task of tasks) {
      if (!task.enabled || !task.schedule) continue;
      const due = this.dueMs(task);
      if (due === null || due > now) continue;
      if (this.busy.has(task.id)) continue;

      const occurrences = this.collect(task, due, now);
      if (occurrences.length === 0) {
        // Plus d'occurrence possible (expression cassee) : on deplanifie pour
        // ne pas reveiller en boucle.
        task.nextRunAt = this.computeNext(task, now);
        changed = true;
        continue;
      }

      const lateBy = now - due;
      let toRun: number[] = [];
      if (lateBy > this.threshold) {
        if (this.catchUp === "skip") {
          this.recordSkip(task, due);
        } else if (this.catchUp === "run-once") {
          toRun = [due];
        } else {
          toRun = occurrences;
        }
      } else {
        toRun = [due];
      }

      const last = occurrences[occurrences.length - 1];
      // En rattrapage, on repart de maintenant : le calendrier avance toujours.
      const after = lateBy > this.threshold ? Math.max(now, last) : last;
      task.nextRunAt = this.computeNext(task, after);
      changed = true;
      if (toRun.length > 0) planned.push({ task, scheduledFor: toRun });
    }

    if (changed) saveTasks(tasks, this.dir);

    for (const entry of planned) {
      this.launchSequence(entry.task, entry.scheduledFor);
    }
    this.arm();
  }

  /** Libere le verrou d'une tache puis re-evalue les echeances.
   *  Sans ce reveil, une occurrence devenue due pendant l'execution
   *  (`triggerNow` / `runNow` n'avancent pas le calendrier) resterait due sur
   *  disque en panne depuis que `arm()` ignore les taches busy. Le
   *  rattrapage reste unique : le premier reveil avance `nextRunAt`, le
   *  suivant ne trouve plus rien a lancer. */
  private release(id: string): void {
    this.busy.delete(id);
    this.wake();
  }

  /** Declenchement manuel DETACHE : pre-controles synchrones (tache connue,
   *  aucune execution en cours), puis execution en arriere-plan. Le serveur
   *  stdio reste disponible pour les autres requetes ; le resultat se lit
   *  via l'historique (readExecutions). */
  triggerNow(id: string): TriggerOutcome {
    const { tasks } = loadTasks(this.dir);
    const task = findTask(tasks, id);
    if (!task) return { ok: false, reason: `tâche introuvable : ${id}` };
    if (this.busy.has(task.id)) return { ok: false, reason: `exécution déjà en cours : ${task.name}` };
    this.busy.add(task.id);
    const context: RunContext = { trigger: "manual", scheduledFor: null };
    void Promise.resolve()
      .then(() => this.run(task, context))
      .catch(() => {
        // L'executeur journalise deja l'echec : on evite surtout un rejet
        // non capte qui tuerait le serveur.
      })
      .finally(() => {
        this.release(task.id);
      });
    return { ok: true };
  }

  /** Declenchement manuel avec attente : usage programmatique et tests. */
  async runNow(id: string): Promise<TriggerOutcome & { result?: unknown }> {
    const { tasks } = loadTasks(this.dir);
    const task = findTask(tasks, id);
    if (!task) return { ok: false, reason: `tâche introuvable : ${id}` };
    if (this.busy.has(task.id)) return { ok: false, reason: `exécution déjà en cours : ${task.name}` };
    this.busy.add(task.id);
    try {
      const result = await this.run(task, { trigger: "manual", scheduledFor: null });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      this.release(task.id);
    }
  }

  /** Enfile les occurrences prevues d'une tache : strictement sequencees, la
   *  suivante ne demarre que si la precedente est terminee. Le verrou `busy`
   *  reste pris pendant toute la sequence. */
  private launchSequence(task: Task, scheduled: number[]): void {
    if (scheduled.length === 0 || this.busy.has(task.id)) return;
    this.busy.add(task.id);
    const runOne = (index: number): Promise<void> => {
      if (index >= scheduled.length) return Promise.resolve();
      const context: RunContext = {
        trigger: "schedule",
        scheduledFor: new Date(scheduled[index]).toISOString()
      };
      return Promise.resolve()
        .then(() => this.run(task, context))
        .catch(() => {
          // L'executeur journalise deja l'echec : on evite surtout un rejet
          // non capte qui tuerait le serveur.
        })
        .then(() => runOne(index + 1));
    };
    void runOne(0).finally(() => {
      this.release(task.id);
    });
  }

  /** Trace d'une occurrence non rejouee : l'historique reste complet. */
  private recordSkip(task: Task, scheduledFor: number): void {
    try {
      const stamp = new Date(this.now()).toISOString();
      appendExecution(
        {
          id: newId("e"),
          taskId: task.id,
          taskName: task.name,
          trigger: "schedule",
          status: "skipped",
          startedAt: stamp,
          finishedAt: stamp,
          durationMs: 0,
          output: "occurrence non rattrapée (politique skip ou retard au-delà du seuil)",
          scheduledFor: new Date(scheduledFor).toISOString()
        },
        this.dir
      );
    } catch {
      // Journal inaccessible : l'ordonnancement passe quand meme.
    }
  }
}
