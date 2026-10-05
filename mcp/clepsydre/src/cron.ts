// clepsydre — parseur de planification ecrit integralement pour ce depot.
// Aucun code de scheduling externe n'a ete copie (voir NOTICE.md).
//
// Trois formes d'expression sont reconnues :
//   * cron 5 champs : "*/5 * * * *" (minute heure jour-mois mois jour-semaine)
//   * intervalle    : "every 30s" / "every 10m" / "every 2h" / "every 1d"
//   * one-shot      : date ISO 8601, "2026-10-05T09:00:00Z"
// Macros cron : @hourly @daily @midnight @weekly @monthly @yearly @annually.
// "@reboot" est rejete explicitement : un serveur MCP n'a pas d'etat de boot.
//
// Semantique retenue (cron Vixie) : quand jour-mois ET jour-semaine sont
// restreints, la journee correspond si l'un OR l'autre correspond. Les heures
// sont calculees sur le calendrier LOCAL du fuseau (IANA optionnel), jamais en
// additionnant des millisecondes : un passage d'heure d'ete ne decale pas la
// tache, il la saute (heure locale inexistante) ou la sert une fois (heure
// locale repetee).

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

export type Schedule =
  | { kind: "cron"; expression: string; fields: CronFields }
  | { kind: "interval"; expression: string; ms: number }
  | { kind: "once"; expression: string; at: number };

const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *"
};

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const UNITS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseNumber(token: string, min: number, max: number, label: string): number {
  if (!/^\d+$/.test(token)) {
    throw new ScheduleError(`${label} : valeur numerique attendue, "${token}" recu`);
  }
  const value = Number(token);
  if (value < min || value > max) {
    throw new ScheduleError(`${label} : ${token} hors bornes ${min}-${max}`);
  }
  return value;
}

function parseValue(
  token: string,
  min: number,
  max: number,
  names: readonly string[] | null,
  label: string
): number {
  if (/^\d+$/.test(token)) return parseNumber(token, min, max, label);
  if (names) {
    const index = names.indexOf(token.toLowerCase());
    if (index >= 0) return min + index;
  }
  throw new ScheduleError(`${label} : "${token}" inconnu (noms acceptes : ${names ? names.join(", ") : "aucun"})`);
}

// Un champ cron : "* | n | a-b | a-b/n | a/n | liste,separee,par,des,virgules"
function parseField(
  spec: string,
  min: number,
  max: number,
  names: readonly string[] | null,
  label: string
): number[] {
  if (spec.length === 0) throw new ScheduleError(`${label} : champ vide`);
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    if (part.length === 0) throw new ScheduleError(`${label} : element vide dans "${spec}"`);
    const segments = part.split("/");
    if (segments.length > 2) throw new ScheduleError(`${label} : "${part}" contient plus d'une barre oblique`);
    const [range, stepSpec] = segments;
    let step = 1;
    if (stepSpec !== undefined) {
      step = parseNumber(stepSpec, 1, max, `${label} (pas)`);
    }
    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const bounds = range.split("-");
      if (bounds.length !== 2 || bounds[0].length === 0 || bounds[1].length === 0) {
        throw new ScheduleError(`${label} : intervalle mal forme "${part}"`);
      }
      start = parseValue(bounds[0], min, max, names, label);
      end = parseValue(bounds[1], min, max, names, label);
      if (start > end) throw new ScheduleError(`${label} : intervalle inverse "${part}"`);
    } else {
      start = parseValue(range, min, max, names, label);
      // "5/15" signifie 5-max par pas de 15 (semantique cron Vixie).
      end = stepSpec === undefined ? start : max;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return Array.from(values).sort((a, b) => a - b);
}

function looksLikeDate(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(input);
}

export function parseSchedule(input: string): Schedule {
  const expression = String(input ?? "").trim();
  if (expression.length === 0) throw new ScheduleError("schedule vide");

  if (expression.startsWith("@")) {
    const macro = expression.toLowerCase();
    if (macro === "@reboot") {
      throw new ScheduleError(
        "@reboot n'est pas supporte : ce serveur n'a pas d'etat de boot. Utilisez une date ISO pour un declenche unique."
      );
    }
    const expanded = MACROS[macro];
    if (!expanded) {
      throw new ScheduleError(`macro inconnue "${expression}" (acceptees : ${Object.keys(MACROS).join(", ")})`);
    }
    return parseCron(expanded);
  }

  if (/^every\s+/i.test(expression)) {
    const match = /^every\s+(\d+)\s*([a-z]+)$/i.exec(expression);
    if (!match) {
      throw new ScheduleError(
        `interval mal forme "${expression}" : attendu "every <nombre><unite>" avec unite parmi s, m, h, d (ex. every 30s)`
      );
    }
    const unit = UNITS[match[2].toLowerCase()];
    if (unit === undefined) {
      throw new ScheduleError(`unite inconnue "${match[2]}" (acceptees : s, m, h, d)`);
    }
    const count = Number(match[1]);
    if (count < 1) throw new ScheduleError("l'intervalle doit etre superieur a 0");
    return { kind: "interval", expression, ms: count * unit };
  }

  if (looksLikeDate(expression)) {
    const at = Date.parse(expression);
    if (Number.isNaN(at)) {
      throw new ScheduleError(`date ISO illisible "${expression}" (attendu : 2026-10-05T09:00:00)`);
    }
    return { kind: "once", expression, at };
  }

  return parseCron(expression);
}

function parseCron(expression: string): Schedule {
  const parts = expression.split(/\s+/);
  if (parts.length !== 5) {
    throw new ScheduleError(
      `expression cron a ${parts.length} champs, 5 attendus (minute heure jour mois jour-semaine). ` +
        `Exemple : "*/5 * * * *" toutes les 5 minutes`
    );
  }
  const [minute, hour, dom, month, dow] = parts;
  // Le champ jour-semaine accepte 0-7 (7 = dimanche) : on ramene a 0-6.
  const daysOfWeek = parseField(dow, 0, 7, DAY_NAMES, "jour-semaine").map((value) => (value === 7 ? 0 : value));
  const fields: CronFields = {
    minutes: parseField(minute, 0, 59, null, "minute"),
    hours: parseField(hour, 0, 23, null, "heure"),
    daysOfMonth: parseField(dom, 1, 31, null, "jour-mois"),
    months: parseField(month, 1, 12, MONTH_NAMES, "mois"),
    daysOfWeek: Array.from(new Set(daysOfWeek)).sort((a, b) => a - b),
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*"
  };
  return { kind: "cron", expression, fields };
}

// ---------------------------------------------------------------------------
// Calendrier local (fuseau IANA optionnel)
// ---------------------------------------------------------------------------

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function assertTimezone(tz: string): void {
  try {
    formatter(tz);
  } catch {
    throw new ScheduleError(`fuseau horaire inconnu "${tz}" (attendu un identifiant IANA, ex. Europe/Paris)`);
  }
}

function formatter(tz?: string): Intl.DateTimeFormat {
  const key = tz ?? "";
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short"
  });
  formatters.set(key, created);
  return created;
}

function wallOf(instant: number, tz?: string): Wall {
  const parts = formatter(tz).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second"))
  };
}

function weekdayOf(wall: Pick<Wall, "year" | "month" | "day">): number {
  // La date de calendrier porte son jour de la semaine : aucune conversion
  // d'heure n'entre en jeu.
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

function offsetMs(instant: number, tz?: string): number {
  const wall = wallOf(instant, tz);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - instant;
}

// Heure locale -> instant UTC. Deux passes suffisent (la seconde lit
// l'offset de l'instant deja deplace). Retourne null quand l'heure locale
// n'existe pas : c'est le trou d'une heure d'ete, le candidat est saute.
function instantOf(wall: Wall, tz?: string): number | null {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const first = naive - offsetMs(naive, tz);
  const second = naive - offsetMs(first, tz);
  const back = wallOf(second, tz);
  const same =
    back.year === wall.year &&
    back.month === wall.month &&
    back.day === wall.day &&
    back.hour === wall.hour &&
    back.minute === wall.minute;
  return same ? second : null;
}

function addHour(wall: Wall, resetMinute = true): void {
  if (resetMinute) wall.minute = 0;
  wall.hour += 1;
  if (wall.hour > 23) {
    wall.hour = 0;
    addDay(wall);
  }
}

function addMinute(wall: Wall): void {
  wall.minute += 1;
  if (wall.minute > 59) {
    wall.minute = 0;
    addHour(wall, false);
  }
}

function addDay(wall: Wall): void {
  wall.hour = 0;
  wall.minute = 0;
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));
  wall.year = next.getUTCFullYear();
  wall.month = next.getUTCMonth() + 1;
  wall.day = next.getUTCDate();
}

function addMonth(wall: Wall): void {
  wall.hour = 0;
  wall.minute = 0;
  wall.day = 1;
  const next = new Date(Date.UTC(wall.year, wall.month, 1));
  wall.year = next.getUTCFullYear();
  wall.month = next.getUTCMonth() + 1;
}

// Recherche du prochain instant en avancant calendrier en calendrier (mois ->
// jour -> heure -> minute) : aucune enumeration minute par minute sur des
// annees entieres.
function nextCron(fields: CronFields, afterMs: number, tz?: string): number | null {
  const wall = wallOf(afterMs, tz);
  wall.second = 0;
  const startYear = wall.year;
  const first = instantOf(wall, tz);
  if (first !== null && first <= afterMs) addMinute(wall);

  for (let guard = 0; guard < 500_000; guard += 1) {
    if (wall.year > startYear + 5) return null;
    if (!fields.months.includes(wall.month)) {
      addMonth(wall);
      continue;
    }
    const weekday = weekdayOf(wall);
    const domMatch = fields.daysOfMonth.includes(wall.day);
    const dowMatch = fields.daysOfWeek.includes(weekday);
    const dayMatch =
      fields.domRestricted && fields.dowRestricted
        ? domMatch || dowMatch
        : fields.domRestricted
          ? domMatch
          : fields.dowRestricted
            ? dowMatch
            : true;
    if (!dayMatch) {
      addDay(wall);
      continue;
    }
    if (!fields.hours.includes(wall.hour)) {
      addHour(wall);
      continue;
    }
    if (!fields.minutes.includes(wall.minute)) {
      addMinute(wall);
      continue;
    }
    const instant = instantOf(wall, tz);
    if (instant === null || instant <= afterMs) {
      // Heure locale inexistante (trou DST) : on passe au creneau suivant.
      addMinute(wall);
      continue;
    }
    return instant;
  }
  return null;
}

/** Prochain declenchement STRICTEMENT apres `afterMs`, ou null si aucun. */
export function nextRun(schedule: Schedule, afterMs: number, tz?: string): number | null {
  if (tz !== undefined && tz.length > 0) assertTimezone(tz);
  if (schedule.kind === "cron") return nextCron(schedule.fields, afterMs, tz);
  if (schedule.kind === "interval") return afterMs + schedule.ms;
  return schedule.at > afterMs ? schedule.at : null;
}

// ---------------------------------------------------------------------------
// Description lisible (outils MCP et historique)
// ---------------------------------------------------------------------------

function plural(value: number, singular: string, feminine = false): string {
  return `${value} ${singular}${value > 1 ? (feminine ? "s" : "s") : ""}`;
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === "interval") {
    const ms = schedule.ms;
    if (ms % 86_400_000 === 0) return `toutes les ${plural(ms / 86_400_000, "jour", true)}`;
    if (ms % 3_600_000 === 0) return `toutes les ${plural(ms / 3_600_000, "heure", true)}`;
    if (ms % 60_000 === 0) return `toutes les ${plural(ms / 60_000, "minute", true)}`;
    return `toutes les ${plural(ms / 1000, "seconde", true)}`;
  }
  if (schedule.kind === "once") {
    return `une seule fois le ${new Date(schedule.at).toISOString()}`;
  }
  return `cron "${schedule.expression}"`;
}
