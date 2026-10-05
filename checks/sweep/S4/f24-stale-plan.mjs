import { run, J, errs, fx, policy } from "./lib.mjs";
// Every successful write at the restaurant makes an open plan stale; previews, replays, failures, no-ops and writes
// at another restaurant do not. restaurant_revision in the preview equals the counter.
await run("f24-stale-plan", "Any intervening restaurant revision invalidates the plan: 409 `stale_plan`, changing nothing.", async (call, h0) => {
  const e = errs();
  const D = "2027-09-23";
  const CL = { table_id: "t_2", from: `${D}T19:00:00+02:00`, to: `${D}T20:00:00+02:00` };
  let h = h0;
  const setup = async () => {
    await call("POST", "/_test/reset", fx());
    h = (await import("./lib.mjs")).h4(call);
    const a = await h.book({ table_id: "t_2", starts_at_local: `${D}T19:00` }, "ada", "base-a");
    const b = await h.book({ table_id: "t_3", starts_at_local: `${D}T12:00` });
    const c = await h.book({ table_id: "t_1", starts_at_local: "2027-09-16T12:00" });
    const s = await h.series({ anchor_reference: c.b.reference, count: 2, interval_weeks: 1 }, "ada", "base-s");
    return { a: a.b, b: b.b, s: s.b };
  };
  const cases = [
    ["new booking", true, (x) => h.book({ table_id: "t_1", starts_at_local: `${D}T21:00` })],
    ["real patch", true, (x) => h.patch(x.b.reference, { party_size: 1 })],
    ["cancel", true, (x) => h.cancel(x.b.reference)],
    ["policy publication", true, () => h.publish(policy())],
    ["moves batch", true, (x) => h.moves([{ reference: x.b.reference, starts_at_local: `${D}T13:00` }])],
    ["series adoption", true, async (x) => h.series({ anchor_reference: x.b.reference, count: 2, interval_weeks: 1 })],
    ["series amend", true, (x) => h.amend(x.s.series_id, { expected_revision: 1, from_index: 0, local_time: "13:00" })],
    ["other plan applied", true, async () => { const q = await h.replan({ table_id: "t_3", from: `${D}T12:00:00+02:00`, to: `${D}T13:00:00+02:00` }); return h.apply(q.b.plan_id); }],
    ["another preview", false, () => h.replan({ table_id: "t_3", from: `${D}T12:00:00+02:00`, to: `${D}T13:00:00+02:00` })],
    ["booking replay", false, () => h.book({ table_id: "t_2", starts_at_local: `${D}T19:00` }, "ada", "base-a")],
    ["series replay", false, (x) => h.series({ anchor_reference: x.s.occurrences[0].reference, count: 2, interval_weeks: 1 }, "ada", "base-s")],
    ["failed booking", false, () => h.book({ table_id: "t_2", starts_at_local: `${D}T19:30` })],
    ["no-op patch", false, (x) => h.patch(x.b.reference, { party_size: 2 })],
    ["failed policy", false, () => h.publish(policy({ slot_minutes: 0 }))],
    ["no-op series amend", false, (x) => h.amend(x.s.series_id, { expected_revision: 1, from_index: 0, local_time: "12:00" })],
    ["repeated cancel", false, async (x) => { await h.cancel(x.b.reference); return h.cancel(x.b.reference); }, true],
    ["write at another restaurant", false, () => h.book({ restaurant_id: "r_ny", table_id: "n_1", starts_at_local: `${D}T19:00` })],
  ];
  for (const [what, stale, act, preCancel] of cases) {
    const x = await setup();
    if (preCancel) await h.cancel(x.b.reference);
    const p = await h.replan(CL);
    if (p.s !== 201) { e.push(`${what}: preview ${p.s} ${J(p.b)}`); continue; }
    const rr = await h.rrev();
    e.check(p.b.restaurant_revision === rr, `${what}: preview restaurant_revision ${p.b.restaurant_revision} != counter ${rr}`);
    const r = await act(x);
    const before = J((await call("GET", "/_test/export")).b.state.reservations);
    const ap = await h.apply(p.b.plan_id);
    if (stale) {
      e.check(ap.s === 409 && ap.b?.error?.code === "stale_plan", `${what} (${r?.s}): apply ${ap.s} ${ap.b?.error?.code}, want stale_plan`);
      e.check(J((await call("GET", "/_test/export")).b.state.reservations) === before, `${what}: stale apply changed reservations`);
    } else e.check(ap.s === 201, `${what} (${r?.s}): apply ${ap.s} ${ap.b?.error?.code}, want 201`);
  }
  return e.result();
});
