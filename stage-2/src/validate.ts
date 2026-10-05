// Request validation helpers: the one place that decides 400 malformed_request vs 422 validation_failed.
// Wrong JSON type of a present field -> 400. Missing required field, bad format or range -> 422.
import { malformed, validation } from "./errors.ts";

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Body must be a JSON object, else 400. */
export function asObject(v: unknown): Obj {
  return isObj(v) ? v : malformed("body must be a JSON object");
}

export function reqString(o: Obj, f: string): string {
  const v = o[f];
  if (v === undefined || v === null) return validation(`${f} is required`);
  if (typeof v !== "string") return malformed(`${f} must be a string`);
  return v;
}

export function optString(o: Obj, f: string): string | undefined {
  const v = o[f];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return malformed(`${f} must be a string`);
  return v;
}

/** Plain decimal digits only (`1e9`, `4.0`, `+4` are not): for integer query parameters. */
export function queryInt(q: URLSearchParams, f: string): number {
  const v = q.get(f);
  if (v === null || v === "") return validation(`${f} is required`);
  if (!/^[0-9]{1,15}$/.test(v)) return validation(`${f} must be a whole number written in decimal digits`);
  return Number(v);
}

export function queryString(q: URLSearchParams, f: string): string {
  const v = q.get(f);
  return v === null || v === "" ? validation(`${f} is required`) : v;
}

export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
