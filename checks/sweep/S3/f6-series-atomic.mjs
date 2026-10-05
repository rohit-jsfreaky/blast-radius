import { run, J, errs, policy } from "./lib.mjs";
await run("f6-series-atomic", "No partial series, reservations, histories, counters or idempotency claim survive failure.", async (call, h) => {
  const e = errs();
  const tok = await h.login();
  const list = async () => (await call("GET", "/reservations", undefined, h.auth(tok))).b.reservations.length;
  const a = await h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:00" });
  await h.book({ table_id: "t_1", starts_at_local: "2027-10-07T19:30" }, "bob"); // blocks occurrence 2
  const n0 = await list(), r0 = await h.rrev(), ex0 = J((await call("GET", "/_test/export")).b.state.reservations);
  const f = await h.series({ anchor_reference: a.b.reference, count: 4, interval_weeks: 1 }, "ada", "ser-k");
  e.check(f.s === 409 && f.b?.error?.code === "table_unavailable", `conflicting occurrence ${f.s} ${J(f.b)}`);
  e.check(await list() === n0 && await h.rrev() === r0, "failed adoption left reservations or counter");
  e.check(J((await call("GET", "/_test/export")).b.state.reservations) === ex0, "failed adoption changed stored reservations");
  const ok = await h.series({ anchor_reference: a.b.reference, count: 2, interval_weeks: 1 }, "ada", "ser-k");
  e.check(ok.s === 201, `key reuse after failed adoption ${ok.s}`);
  e.check((await h.series({ anchor_reference: a.b.reference, count: 2, interval_weeks: 1 })).b?.error?.code === "already_in_series", "already_in_series");
  // occurrence policy: first failing occurrence in index order decides; per-date capacity
  const b = await h.book({ table_id: "t_2", starts_at_local: "2027-09-23T12:00", party_size: 4 });
  await h.publish(policy({ effective_from: "2027-10-07", capacities: { t_1: 2, t_2: 3, t_3: 4 } }));
  const c = await h.series({ anchor_reference: b.b.reference, count: 3, interval_weeks: 1 });
  e.check(c.b?.error?.code === "party_exceeds_capacity", `occurrence under later policy capacity: ${c.s} ${J(c.b)}`);
  // DST: anchor Sunday 2027-03-21 02:30 Berlin, next week 02:30 does not exist
  const d = await h.book({ table_id: "t_3", starts_at_local: "2027-03-21T02:30" });
  const g = await h.series({ anchor_reference: d.b?.reference, count: 2, interval_weeks: 1 });
  e.check(g.b?.error?.code === "invalid_local_time", `DST gap occurrence: ${g.s} ${J(g.b)}`);
  // validation
  for (const [bd, what] of [[{ count: 1 }, "count 1"], [{ count: 13 }, "count 13"], [{ count: true }, "count bool"], [{ interval_weeks: 5 }, "interval 5"], [{ interval_weeks: 0 }, "interval 0"]]) {
    const r = await h.series({ anchor_reference: b.b.reference, count: 2, interval_weeks: 1, ...bd });
    e.check(r.s === 422, `${what}: ${r.s}`);
  }
  await h.cancel(b.b.reference);
  e.check((await h.series({ anchor_reference: b.b.reference, count: 2, interval_weeks: 1 })).b?.error?.code === "reservation_cancelled", "cancelled anchor");
  return e.result();
});
