// S10: table sets (single tables and declared pairs): the options a restaurant offers, which are free, and which a request may name.
// One predicate for availability, create, patch and moves (F2 overlap over sets, F9 bookability).
import { fail, malformed, notFound, validation } from "./errors.ts";
import { findOverlap } from "./store.ts";
import type { Restaurant, State } from "./store.ts";
import type { Obj } from "./validate.ts";

export interface Option { table_ids: string[]; capacity: number }

const capacityOf = (r: Restaurant, ids: string[]): number => ids.reduce((n, id) => n + (r.tables.find((t) => t.id === id)?.capacity ?? 0), 0);

/** Every single table (fixture order) then every declared pair (combinable order, first declaration wins), each with its capacity. */
export function allOptions(r: Restaurant): Option[] {
  const out: Option[] = r.tables.map((t) => ({ table_ids: [t.id], capacity: t.capacity }));
  const seen = new Set<string>();
  for (const p of r.combinable) {
    const k = [...p].sort().join("\u0000");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ table_ids: [...p], capacity: capacityOf(r, p) });
  }
  return out;
}

/** Options with capacity >= party and no overlapping confirmed reservation on any member for [startMs, endMs). */
export function freeOptions(s: State, r: Restaurant, party: number, startMs: number, endMs: number): Option[] {
  return allOptions(r).filter((o) => o.capacity >= party && !findOverlap(s, r.id, o.table_ids, startMs, endMs));
}

/**
 * The table set named by a body: `table_id` (a set of one) or `table_ids`; both -> 422; neither -> undefined.
 * Wrong JSON types -> 400; empty set or duplicates -> 422 validation_failed.
 */
export function readTableIds(o: Obj): string[] | undefined {
  const one = o.table_id, many = o.table_ids;
  if (one !== undefined && many !== undefined) return validation("send table_id or table_ids, not both");
  if (one !== undefined) {
    if (one === null) return validation("table_id must not be null");
    if (typeof one !== "string") return malformed("table_id must be a string");
    return [one];
  }
  if (many === undefined) return undefined;
  if (many === null) return validation("table_ids must not be null");
  if (!Array.isArray(many)) return malformed("table_ids must be an array of strings");
  if (many.some((x) => typeof x !== "string")) return malformed("table_ids must be an array of strings");
  if (many.length === 0) return validation("table_ids must name at least one table");
  if (new Set(many).size !== many.length) return validation("table_ids must not repeat a table");
  return many as string[];
}

/** A requested set -> the set to store (declared pairs in `combinable` order). Unknown table 404; more than two or an undeclared pair 422 combination_not_allowed. */
export function resolveTableSet(r: Restaurant, ids: string[]): string[] {
  for (const id of ids) if (!r.tables.some((t) => t.id === id)) return notFound("no such table at this restaurant");
  if (ids.length === 1) return [...ids];
  if (ids.length === 2) {
    const pair = r.combinable.find((p) => p.includes(ids[0]) && p.includes(ids[1]));
    if (pair) return [...pair];
  }
  return fail(422, "combination_not_allowed", "those tables are not a declared combination");
}

export const setCapacity = capacityOf;
