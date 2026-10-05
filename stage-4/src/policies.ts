// S14: booking policies (stage 3). One selector for "which rules apply to a booking starting on this local date",
// and the publish/list endpoints. Policies are immutable; policy 0 is the fixture's own rules.
import { forbidden, malformed, notFound, validation } from "./errors.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import type { Router } from "./router.ts";
import { read, restaurantById, transact } from "./store.ts";
import type { OpeningHours, Policy, Restaurant, State, Terms } from "./store.ts";
import { parseDate, parseLocal } from "./time.ts";
import { asObject, isInt, isObj } from "./validate.ts";
import type { Obj } from "./validate.ts";

export type { Terms };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The rules the fixture itself declares (policy 0), with capacities taken from the tables. */
export function baseTerms(r: Restaurant): Terms {
  return {
    policy_version: 0, slot_minutes: r.slot_minutes, reservation_duration_minutes: r.reservation_duration_minutes,
    cancellation_cutoff_minutes: r.cancellation_cutoff_minutes,
    opening_hours: r.opening_hours.map((o) => ({ ...o })), capacities: Object.fromEntries(r.tables.map((t) => [t.id, t.capacity])),
  };
}

export const termsOf = (p: Policy): Terms => ({
  policy_version: p.policy_version, slot_minutes: p.slot_minutes, reservation_duration_minutes: p.reservation_duration_minutes,
  cancellation_cutoff_minutes: p.cancellation_cutoff_minutes, opening_hours: p.opening_hours.map((o) => ({ ...o })), capacities: { ...p.capacities },
});

/**
 * The terms for a booking whose LOCAL start date is `localDate` (YYYY-MM-DD): the policy with the greatest
 * effective_from not later than the date, ties -> greatest policy_version, otherwise policy 0. A fresh copy each call.
 */
export function termsFor(_s: State, r: Restaurant, localDate: string): Terms {
  let best: Policy | null = null;
  for (const p of r.policies ?? []) {
    if (p.effective_from > localDate) continue;
    if (!best || p.effective_from > best.effective_from || (p.effective_from === best.effective_from && p.policy_version > best.policy_version)) best = p;
  }
  return best ? termsOf(best) : baseTerms(r);
}

/** Terms for a bare local start `YYYY-MM-DDTHH:MM` (422 validation_failed when it is not one). */
export function termsForLocal(s: State, r: Restaurant, local: string): Terms {
  if (!parseLocal(local)) validation("starts_at_local must be a bare local YYYY-MM-DDTHH:MM");
  return termsFor(s, r, local.slice(0, 10));
}

export const capacityOf = (terms: Terms, tableIds: string[]): number => tableIds.reduce((n, id) => n + (terms.capacities[id] ?? 0), 0);

function intIn(v: unknown, lo: number, hi: number, what: string): number {
  if (v === undefined || v === null) return validation(`${what} is required`);
  return isInt(v) && v >= lo && v <= hi ? v : validation(`${what} must be a whole number from ${lo} to ${hi}`);
}

/** A complete policy body -> Terms-shaped fields + effective_from. Invalid -> 422; nothing is allocated. */
export function parsePolicy(body: Obj, r: Restaurant): Omit<Policy, "policy_version"> {
  const ef = body.effective_from;
  if (ef === undefined || ef === null) validation("effective_from is required");
  if (typeof ef !== "string") malformed("effective_from must be a string");
  if (!parseDate(ef)) validation("effective_from must be a calendar date YYYY-MM-DD");
  const slot_minutes = intIn(body.slot_minutes, 1, 1440, "slot_minutes");
  const reservation_duration_minutes = intIn(body.reservation_duration_minutes, 1, 1440, "reservation_duration_minutes");
  const cancellation_cutoff_minutes = intIn(body.cancellation_cutoff_minutes, 0, 10080, "cancellation_cutoff_minutes");
  const oh = body.opening_hours;
  if (oh === undefined || oh === null) validation("opening_hours is required");
  if (!Array.isArray(oh)) malformed("opening_hours must be an array");
  const seen = new Set<string>();
  const opening_hours: OpeningHours[] = (oh as unknown[]).map((x) => {
    if (!isObj(x)) return validation("each opening_hours entry must be an object");
    const { weekday, opens, closes } = x;
    if (typeof weekday !== "string" || !WEEKDAYS.includes(weekday)) return validation("weekday must be one of mon..sun");
    if (typeof opens !== "string" || !HHMM.test(opens) || typeof closes !== "string" || !HHMM.test(closes)) return validation("opens and closes must be HH:MM");
    if (toMin(closes) <= toMin(opens)) return validation("closes must be later than opens");
    if (seen.has(weekday)) return validation("opening_hours must not repeat a weekday");
    seen.add(weekday);
    return { weekday, opens, closes };
  });
  const cap = body.capacities;
  if (cap === undefined || cap === null) validation("capacities is required");
  if (!isObj(cap)) malformed("capacities must be an object");
  const ids = r.tables.map((t) => t.id);
  const keys = Object.keys(cap as Obj);
  if (keys.length !== ids.length || !ids.every((id) => keys.includes(id))) validation("capacities must name exactly the restaurant's tables");
  const capacities: Record<string, number> = {};
  for (const id of ids) capacities[id] = intIn((cap as Obj)[id], 1, 100, `capacity of ${id}`);
  return { effective_from: ef as string, slot_minutes, reservation_duration_minutes, cancellation_cutoff_minutes, opening_hours, capacities };
}

/** Public shape of a published policy. */
export const policyBody = (p: Policy) => ({
  policy_version: p.policy_version, effective_from: p.effective_from, slot_minutes: p.slot_minutes,
  reservation_duration_minutes: p.reservation_duration_minutes, cancellation_cutoff_minutes: p.cancellation_cutoff_minutes,
  opening_hours: p.opening_hours.map((o) => ({ ...o })), capacities: { ...p.capacities },
});

export function registerPolicyRoutes(router: Router): void {
  router.add("POST", "/restaurants/:id/policies", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };
      const r = restaurantById(s, ctx.params.id) ?? notFound("no such restaurant");
      if (!r.manager_user_ids.includes(user.id)) forbidden("only a manager of this restaurant may publish policies");
      const p = parsePolicy(body, r);
      const version = r.policies.reduce((m, x) => Math.max(m, x.policy_version), 0) + 1;
      const policy: Policy = { policy_version: version, ...p };
      r.policies.push(policy);
      r.revision += 1;
      const response = policyBody(policy);
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });

  router.add("GET", "/restaurants/:id/policies", { auth: false }, (ctx) => {
    const r = restaurantById(read(), ctx.params.id) ?? notFound("no such restaurant");
    return { status: 200, body: { policies: r.policies.map(policyBody) } };
  });
}
