// Router: method + path pattern -> handler. Auth is checked here (before the handler reads the body), so a missing token is 401.
import { malformed } from "./errors.ts";
import type { User } from "./store.ts";
import { asObject } from "./validate.ts";
import type { Obj } from "./validate.ts";

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  /** The authenticated caller; null on public routes. */
  user: User | null;
  /** Parsed JSON body; 400 malformed_request when it does not parse (also when empty). */
  json(): unknown;
  /** Parsed JSON body that must be an object, else 400 malformed_request. */
  jsonObject(): Obj;
}

export interface Result { status: number; body?: unknown }
export type Handler = (ctx: Ctx) => Result | Promise<Result>;
export interface RouteOpts { auth: boolean }

interface Route { method: string; segs: string[]; opts: RouteOpts; handler: Handler }

export class Router {
  routes: Route[] = [];

  /** pattern like `/reservations/:reference/cancel`. */
  add(method: string, pattern: string, opts: RouteOpts, handler: Handler): void {
    this.routes.push({ method, segs: pattern.split("/").filter(Boolean), opts, handler });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.segs.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length && ok; i++) {
        const seg = route.segs[i];
        if (seg.startsWith(":")) {
          try { params[seg.slice(1)] = decodeURIComponent(parts[i]); } catch { ok = false; }
        } else if (seg !== parts[i]) ok = false;
      }
      if (ok) return { route, params };
    }
    return null;
  }
}

export function makeBodyReaders(raw: string): Pick<Ctx, "json" | "jsonObject"> {
  let parsed: { ok: true; value: unknown } | undefined;
  const json = () => {
    if (!parsed) {
      try { parsed = { ok: true, value: JSON.parse(raw) }; } catch { return malformed("request body is not valid JSON"); }
    }
    return parsed.value;
  };
  return { json, jsonObject: () => asObject(json()) };
}
