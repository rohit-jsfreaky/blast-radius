import { run, J, errs, policy } from "./lib.mjs";
await run("f5-owner-404", "History and decision return 404 even without authentication, resolving the exception to stage 1's general 401 rule.", async (call, h) => {
  const e = errs();
  const a = await h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:00" });
  const s = await h.series({ anchor_reference: a.b.reference, count: 2, interval_weeks: 1 });
  const bob = h.auth(await h.login("bob")), mgr = h.auth(await h.login("mgr"));
  for (const p of [`/reservations/${a.b.reference}/history`, `/reservations/${a.b.reference}/decision`, `/series/${s.b?.series_id}`]) {
    for (const [who, hd] of [["no token", {}], ["bob", bob], ["manager", mgr], ["bad token", { authorization: "Bearer nope" }]]) {
      const r = await call("GET", p, undefined, hd);
      e.check(r.s === 404 && r.b?.error?.code === "not_found", `${p} as ${who}: ${r.s}`);
    }
  }
  for (const p of ["/reservations/NOSUCH1/history", "/reservations/NOSUCH1/decision", "/series/nosuch"]) {
    const r = await call("GET", p); e.check(r.s === 404, `${p} unknown no token: ${r.s}`);
  }
  const w = async (who, rid, hd) => (await call("POST", `/restaurants/${rid}/policies`, policy(), { ...hd, "idempotency-key": `p-${who}-${rid}` })).s;
  e.check(await w("bob", "r_anker", bob) === 403, "non-manager publish not 403");
  e.check(await w("none", "r_anker", {}) === 401, "no-token publish not 401");
  e.check(await w("mgr", "r_nope", mgr) === 404, "unknown restaurant publish not 404");
  e.check((await call("GET", `/reservations/${a.b.reference}`, undefined, mgr)).s === 404, "manager can read a diner's booking");
  e.check((await call("POST", `/reservations/${a.b.reference}/cancel`, {}, bob)).s === 404, "other user can cancel");
  return e.result();
});
