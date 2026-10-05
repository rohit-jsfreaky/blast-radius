import { run, J, errs, fx, policy } from "./lib.mjs";
// INC-1/INC-2 lesson: new state entering through reset or import must satisfy the invariants the API guarantees.
await run("inc-seed-stage3", "Restaurants may now declare `manager_user_ids` in their reset fixture (default `[]`).", async (call, h) => {
  const e = errs();
  const rej = async (what, f) => { const r = await call("POST", "/_test/reset", f); e.check(r.s >= 400 && r.s < 500, `reset ${what}: ${r.s}`); };
  const m = (ids) => { const f = fx(); f.restaurants[0].manager_user_ids = ids; return f; };
  await rej("manager_user_ids not an array", m("u_mgr"));
  await rej("manager id not a string", m([5]));
  const ok = await call("POST", "/_test/reset", (() => { const f = fx(); delete f.restaurants[0].manager_user_ids; return f; })());
  e.check(ok.s === 204, `manager_user_ids omitted must default to [] (${ok.s})`);
  // seeded bookings: revision 1, policy 0
  await call("POST", "/_test/reset", fx({ reservations: [{ id: "res_s", reference: "SEED01", user_id: "u_ada", restaurant_id: "r_anker", table_id: "t_1", starts_at_local: "2027-09-23T19:00", party_size: 2 }] }));
  const g = (await h.get("SEED01")).b;
  e.check(g.revision === 1 && g.accepted_terms?.policy_version === 0 && J(g.accepted_terms?.capacities) === J({ t_1: 2, t_2: 4, t_3: 4 }), `seeded booking ${J(g)}`);
  e.check((await h.hist("SEED01")).s === 200, "seeded booking has no history endpoint");
  // import of invalid stage-3 state is 422 and leaves the destination unchanged
  await h.publish(policy(), "r_anker", "mgr", "seed-p");
  const s = await h.series({ anchor_reference: "SEED01", count: 2, interval_weeks: 1 });
  e.check(s.s === 201, `series on seeded booking ${s.s} ${J(s.b)}`);
  const ex = (await call("GET", "/_test/export")).b;
  const before = J(ex);
  const tryImport = async (what, mut) => {
    const bad = structuredClone(ex); try { mut(bad.state); } catch (err) { e.push(`${what}: cannot plant (${err.message}) — state layout unknown`); return; }
    const r = await call("POST", "/_test/import", bad);
    e.check(r.s === 422, `import ${what}: ${r.s}`);
    if (r.s === 422) e.check(J((await call("GET", "/_test/export")).b) === before, `import ${what} changed destination`);
    await call("POST", "/_test/import", ex); // restore for the next plant
  };
  const rest = (st) => st.restaurants.find((r) => r.id === "r_anker");
  const resv = (st, ref) => st.reservations.find((r) => r.reference === ref);
  await tryImport("policy capacity 0", (st) => { rest(st).policies[0].capacities.t_1 = 0; });
  await tryImport("policy missing a table capacity", (st) => { delete rest(st).policies[0].capacities.t_3; });
  await tryImport("reservation revision 0", (st) => { resv(st, "SEED01").revision = 0; });
  await tryImport("series names unknown reservation", (st) => { const ser = Array.isArray(st.series) ? st.series[0] : Object.values(st.series)[0]; ser.occurrences[1].reference = "NOPE99"; });
  return e.result();
});
