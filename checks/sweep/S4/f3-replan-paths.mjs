import { run, J, errs } from "./lib.mjs";
// Stage-1 replay rules on the replan and apply paths; manager permission; plan ownership.
await run("f3-replan-paths", "A plan already applied under a different key gives 409 `plan_already_applied`; replay of the successful key returns the original response with 200, even after later changes.", async (call, h) => {
  const e = errs();
  const D = "2027-09-23";
  await h.book({ table_id: "t_2", starts_at_local: `${D}T19:00` });
  const CL = { table_id: "t_2", from: `${D}T19:00:00+02:00`, to: `${D}T20:00:00+02:00` };
  const mgr = await h.login("mgr");
  e.check((await call("POST", "/restaurants/r_anker/replans", CL, h.auth(mgr))).s === 400, "preview without key not 400");
  e.check((await h.replan(CL, "r_anker", "ada")).s === 403, "non-manager preview not 403");
  e.check((await call("POST", "/restaurants/r_anker/replans", CL, { "idempotency-key": "x" })).s === 401, "no-token preview not 401");
  e.check((await h.replan(CL, "r_nope")).s === 404, "unknown restaurant not 404");
  e.check((await h.replan({ ...CL, table_id: "t_9" })).s === 404, "unknown table not 404");
  e.check((await h.replan({ ...CL, table_id: "n_1" })).s === 404, "other restaurant's table not 404");
  for (const [what, b] of [["from == to", { ...CL, to: CL.from }], ["from > to", { ...CL, from: CL.to, to: CL.from }], ["no offset", { ...CL, from: `${D}T19:00:00` }], ["not a date", { ...CL, from: "soon" }], ["missing to", { table_id: "t_2", from: CL.from }]])
    e.check((await h.replan(b)).s === 422, `${what} not 422`);
  const p1 = await h.replan(CL, "r_anker", "mgr", "pv");
  const p1r = await h.replan(CL, "r_anker", "mgr", "pv");
  e.check(p1.s === 201 && p1r.s === 200 && J(p1r.b) === J(p1.b), `preview replay ${p1.s}/${p1r.s}`);
  e.check((await h.replan({ ...CL, to: `${D}T20:30:00+02:00` }, "r_anker", "mgr", "pv")).s === 409, "preview different body same key not 409");
  const nplans = (await call("GET", "/_test/export")).b.state.plans.length;
  e.check(nplans === 1, `preview replay stored ${nplans} plans`);
  e.check((await h.apply(p1.b.plan_id, "r_ny")).s === 404, "plan via other restaurant not 404");
  e.check((await h.apply("plan_nope")).s === 404, "unknown plan not 404");
  e.check((await h.apply(p1.b.plan_id, "r_anker", "ada")).s === 403, "non-manager apply not 403");
  e.check((await call("POST", `/restaurants/r_anker/replans/${p1.b.plan_id}/apply`, {}, h.auth(mgr))).s === 400, "apply without key not 400");
  const a1 = await h.apply(p1.b.plan_id, "r_anker", "mgr", "ak");
  e.check(a1.s === 201 && a1.b.plan_id === p1.b.plan_id && a1.b.restaurant_revision === p1.b.restaurant_revision + 1, `apply ${a1.s} ${J(a1.b)}`);
  // later changes, then replay
  const moved = a1.b.reservations[0];
  await h.patch(moved.reference, { party_size: 1 });
  const a1r = await h.apply(p1.b.plan_id, "r_anker", "mgr", "ak");
  e.check(a1r.s === 200 && J(a1r.b) === J(a1.b), `apply replay after change ${a1r.s}`);
  const a2 = await h.apply(p1.b.plan_id, "r_anker", "mgr", "ak2");
  e.check(a2.s === 409 && ["plan_already_applied", "stale_plan"].includes(a2.b?.error?.code), `applied plan, other key ${a2.s} ${a2.b?.error?.code}`);
  // immediately after apply (no other write) a different key must say plan_already_applied
  await h.book({ table_id: "t_1", starts_at_local: `${D}T21:00` });
  const p2 = await h.replan({ table_id: "t_3", from: `${D}T21:00:00+02:00`, to: `${D}T22:00:00+02:00` });
  const b1 = await h.apply(p2.b.plan_id, "r_anker", "mgr", "bk");
  const b2 = await h.apply(p2.b.plan_id, "r_anker", "mgr", "bk2");
  e.check(b1.s === 201 && b2.s === 409 && b2.b?.error?.code === "plan_already_applied", `plan_already_applied ${b1.s}/${b2.s} ${b2.b?.error?.code}`);
  // same key + {} on another plan's apply path is a different request
  await h.book({ table_id: "t_1", starts_at_local: `${D}T12:00` });
  const p3 = await h.replan({ table_id: "t_1", from: `${D}T12:00:00+02:00`, to: `${D}T13:00:00+02:00` });
  const c1 = await h.apply(p3.b.plan_id, "r_anker", "mgr", "bk");
  e.check(c1.s === 201 && c1.b.plan_id === p3.b.plan_id, `same key other plan path ${c1.s} ${J(c1.b).slice(0, 120)}`);
  // a failed apply (stale) leaves the key reusable
  const p4 = await h.replan({ table_id: "t_3", from: `${D}T09:00:00+02:00`, to: `${D}T10:00:00+02:00` });
  await h.book({ table_id: "t_1", starts_at_local: `${D}T09:00` });
  const st = await h.apply(p4.b.plan_id, "r_anker", "mgr", "fk");
  e.check(st.s === 409 && st.b?.error?.code === "stale_plan", `stale ${st.s}`);
  const p5 = await h.replan({ table_id: "t_3", from: `${D}T09:00:00+02:00`, to: `${D}T10:00:00+02:00` });
  // the failed key on the same path is reusable only on its own path; use it on p5's path
  const ok = await h.apply(p5.b.plan_id, "r_anker", "mgr", "fk");
  e.check(ok.s === 201, `key reuse after failed apply ${ok.s}`);
  return e.result();
});
