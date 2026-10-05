// S6: a restaurant's wall-clock schedule: is this local start bookable, and which slots exist on a date.
// The one validator behind availability, create, patch and moves (F: validation order and error codes).
import { fail, validation } from "./errors.ts";
import type { Restaurant } from "./store.ts";
import { addMinutes, localToInstant, parseLocal, weekdayOf } from "./time.ts";

export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export interface Booking { start_ms: number; end_ms: number }

/**
 * Validates a bare local start for a restaurant and returns its instants. Check order:
 * format (422 validation_failed) -> nonexistent DST time (422 invalid_local_time)
 * -> outside opening hours or ending after closes (422 outside_opening_hours) -> off the slot grid (422 not_on_slot_grid).
 */
export function resolveStart(r: Restaurant, local: string): Booking {
  const p = parseLocal(local);
  if (!p) return validation("starts_at_local must be a bare local YYYY-MM-DDTHH:MM");
  const startMs = localToInstant(r.timezone, p);
  if (startMs === null) return fail(422, "invalid_local_time", "that local time does not exist (daylight-saving gap)");
  const wd = weekdayOf(p.y, p.mo, p.d);
  const t = p.h * 60 + p.mi;
  const dur = r.reservation_duration_minutes;
  const hit = r.opening_hours.find((o) => o.weekday === wd && minutesOf(o.opens) <= t && t + dur <= minutesOf(o.closes));
  if (!hit) return fail(422, "outside_opening_hours", "outside opening hours, or the reservation would end after closing");
  if ((t - minutesOf(hit.opens)) % r.slot_minutes !== 0) return fail(422, "not_on_slot_grid", "start is not on the slot grid");
  return { start_ms: startMs, end_ms: addMinutes(startMs, dur) };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Every slot of a local date in time order. Nonexistent local times are skipped; a repeated hour appears once (first occurrence). */
export function slotsOn(r: Restaurant, y: number, mo: number, d: number): Array<{ local: string; start_ms: number }> {
  const wd = weekdayOf(y, mo, d);
  const out = new Map<string, number>();
  for (const o of r.opening_hours) {
    if (o.weekday !== wd) continue;
    for (let t = minutesOf(o.opens); t + r.reservation_duration_minutes <= minutesOf(o.closes); t += r.slot_minutes) {
      const h = Math.floor(t / 60), mi = t % 60;
      const ms = localToInstant(r.timezone, { y, mo, d, h, mi });
      if (ms === null) continue;
      const local = `${String(y).padStart(4, "0")}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}`;
      if (!out.has(local)) out.set(local, ms);
    }
  }
  return [...out].map(([local, start_ms]) => ({ local, start_ms })).sort((a, b) => a.start_ms - b.start_ms);
}
