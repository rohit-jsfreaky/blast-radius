// S3: the one time/DST module (D4: Node Intl only). Local wall-clock <-> instant per IANA zone.
// Fall back: ambiguous local times resolve to the FIRST occurrence (earlier instant).
// Spring forward: nonexistent local times are detected and reported, never shifted.
const MIN = 60000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", calendar: "gregory", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidZone(tz: unknown): boolean {
  if (typeof tz !== "string" || tz === "") return false;
  try { fmt(tz); return true; } catch { return false; }
}

export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

export function wallAt(tz: string, ms: number): Wall {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** UTC offset of the zone at an instant, in minutes (IANA rules via ICU). */
export function offsetMinutesAt(tz: string, ms: number): number {
  const w = wallAt(tz, ms);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const fmtOffset = (offMin: number) => {
  const a = Math.abs(offMin);
  return `${offMin < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};

/** RFC 3339 with explicit offset in the zone, e.g. 2026-09-24T19:00:00+02:00. */
export function formatInstant(tz: string, ms: number): string {
  const w = wallAt(tz, ms);
  return `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}${fmtOffset(offsetMinutesAt(tz, ms))}`;
}

/** Local wall-clock `YYYY-MM-DDTHH:MM` of an instant in the zone. */
export function formatLocal(tz: string, ms: number): string {
  const w = wallAt(tz, ms);
  return `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

export interface LocalParts { y: number; mo: number; d: number; h: number; mi: number }

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  t.setUTCFullYear(y);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Strict bare `YYYY-MM-DDTHH:MM` (no offset, no Z, no seconds). null when not of that form or not a real date/time. */
export function parseLocal(s: unknown): LocalParts | null {
  if (typeof s !== "string") return null;
  const m = LOCAL_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (!validDate(y, mo, d) || h > 23 || mi > 59) return null;
  return { y, mo, d, h, mi };
}

/** Strict `YYYY-MM-DD`; null when not a real calendar date. */
export function parseDate(s: unknown): { y: number; mo: number; d: number } | null {
  if (typeof s !== "string") return null;
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  return validDate(y, mo, d) ? { y, mo, d } : null;
}

/** mon..sun of a calendar date. */
export function weekdayOf(y: number, mo: number, d: number): string {
  const t = new Date(Date.UTC(2000, mo - 1, d));
  t.setUTCFullYear(y);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][t.getUTCDay()];
}

/**
 * Local wall-clock -> instant (ms). Returns null when the local time does not exist (spring-forward gap).
 * Ambiguous times (fall back) resolve to the first occurrence, the one before the clocks change.
 */
export function localToInstant(tz: string, p: LocalParts): number | null {
  const naive = Date.UTC(2000, p.mo - 1, p.d, p.h, p.mi);
  const nd = new Date(naive);
  nd.setUTCFullYear(p.y);
  const wall = nd.getTime();
  const offs = new Set<number>([offsetMinutesAt(tz, wall - 24 * 60 * MIN), offsetMinutesAt(tz, wall + 24 * 60 * MIN)]);
  const hits: number[] = [];
  for (const o of offs) {
    const cand = wall - o * MIN;
    if (offsetMinutesAt(tz, cand) === o) hits.push(cand);
  }
  return hits.length ? Math.min(...hits) : null;
}

/** Absolute duration: ends_at = start + minutes of real time, shown with the zone's offset at that instant. */
export const addMinutes = (ms: number, minutes: number) => ms + minutes * MIN;
