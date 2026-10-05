// Core routes: health, test control (reset, export, import), auth, restaurants, availability.
import { login, signup } from "./auth.ts";
import { notFound, validation } from "./errors.ts";
import { stateFromExport, stateFromFixture } from "./fixture.ts";
import type { Router } from "./router.ts";
import { registerPolicyRoutes, termsFor } from "./policies.ts";
import { registerSeriesRoutes } from "./series.ts";
import { slotsOn } from "./schedule.ts";
import { findOverlap, read, replaceState, restaurantById } from "./store.ts";
import type { Restaurant } from "./store.ts";
import { freeOptions } from "./tables.ts";
import { formatInstant, parseDate } from "./time.ts";
import { asObject, queryInt, queryString } from "./validate.ts";

/** The restaurant as the fixture declared it: published policies, revisions and other stage-3 state never leak into the detail. */
function fixtureConfig(r: Restaurant) {
  const { policies: _p, revision: _v, manager_user_ids, ...config } = r;
  return manager_user_ids.length ? { ...config, manager_user_ids } : config;
}

export function registerCoreRoutes(router: Router): void {
  router.add("GET", "/health", { auth: false }, () => ({ status: 200, body: { status: "ok" } }));

  router.add("POST", "/_test/reset", { auth: false }, async (ctx) => {
    const next = await stateFromFixture(ctx.jsonObject());
    replaceState(next);
    return { status: 204 };
  });

  router.add("GET", "/_test/export", { auth: false }, () => ({
    status: 200,
    // The committed state object is never mutated after commit, so this is an atomic read-only snapshot.
    body: { track: "tablekeeper", format_version: 1, state: read() },
  }));

  router.add("POST", "/_test/import", { auth: false }, (ctx) => {
    const body = asObject(ctx.jsonObject());
    if (body.track !== "tablekeeper") validation("track must be \"tablekeeper\"");
    if (body.format_version !== 1) validation("format_version must be 1");
    if (body.state === undefined) validation("state is required");
    replaceState(stateFromExport(body.state));
    return { status: 204 };
  });

  registerPolicyRoutes(router);
  registerSeriesRoutes(router);

  router.add("POST", "/auth/signup", { auth: false }, (ctx) => signup(ctx.jsonObject()));
  router.add("POST", "/auth/login", { auth: false }, (ctx) => login(ctx.jsonObject()));

  router.add("GET", "/restaurants", { auth: false }, () => ({
    status: 200,
    body: { restaurants: read().restaurants.map((r) => ({ id: r.id, name: r.name, timezone: r.timezone })) },
  }));

  router.add("GET", "/restaurants/:id", { auth: false }, (ctx) => {
    const r = restaurantById(read(), ctx.params.id) ?? notFound("no such restaurant");
    return { status: 200, body: fixtureConfig(r) };
  });

  router.add("GET", "/availability", { auth: false }, (ctx) => {
    const rid = queryString(ctx.query, "restaurant_id");
    const dateStr = queryString(ctx.query, "date");
    const party = queryInt(ctx.query, "party_size");
    const date = parseDate(dateStr) ?? validation("date must be a calendar date YYYY-MM-DD");
    if (party < 1) validation("party_size must be at least 1");
    const exAll = ctx.query.getAll("explain");
    if (exAll.some((v) => v !== "true")) validation("explain accepts only the value true");
    const ex = exAll.length ? "true" : null;
    const s = read();
    const r = restaurantById(s, rid) ?? notFound("no such restaurant");
    const terms = termsFor(s, r, dateStr);
    const dur = terms.reservation_duration_minutes * 60000;
    const slots = slotsOn(r, date.y, date.mo, date.d, terms).map((sl) => {
      const options = freeOptions(s, r, party, sl.start_ms, sl.start_ms + dur, terms);
      const explain = ex === null ? null : r.tables.map((t) => {
        const capacity = party <= (terms.capacities[t.id] ?? 0);
        const no_overlap = !findOverlap(s, r.id, t.id, sl.start_ms, sl.start_ms + dur);
        return { table_id: t.id, policy_version: terms.policy_version, available: capacity && no_overlap,
          rules: [{ rule: "capacity", holds: capacity }, { rule: "no_overlap", holds: no_overlap }] };
      });
      return {
        starts_at_local: sl.local,
        starts_at: formatInstant(r.timezone, sl.start_ms),
        available_table_ids: options.filter((o) => o.table_ids.length === 1).map((o) => o.table_ids[0]),
        available_options: options,
        ...(explain ? { explain } : {}),
      };
    });
    return { status: 200, body: { restaurant_id: r.id, date: dateStr, timezone: r.timezone, slots } };
  });
}
