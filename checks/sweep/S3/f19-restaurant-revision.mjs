import { run, J, errs, policy, fx } from "./lib.mjs";
// Stage-4 readiness: "A restaurant revision starts at 0 after reset and increments once for each successful new booking,
// real amendment, cancellation, policy publication or plan application. No-op writes, failures, previews and replays do not."
// Stage 3 adds: adoption once, moves batch once. Read from the export state (implementation-defined location `revision`).
await run("f19-restaurant-revision", "Adoption increments the restaurant revision once for the whole operation.", async (call, h) => {
  const e = errs();
  let want = 0;
  const step = async (what, delta, fn) => { const r = await fn(); want += delta; const got = await h.rrev(); e.check(got === want, `${what}: restaurant revision ${got}, want ${want} (${r?.s})`); return r; };
  await step("after reset", 0, async () => {});
  const a = await step("new booking", 1, () => h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:00" }, "ada", "rr-a"));
  await step("replay booking", 0, () => h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:00" }, "ada", "rr-a"));
  await step("failed booking (overlap)", 0, () => h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:30" }));
  await step("booking at other restaurant", 0, () => h.book({ restaurant_id: "r_ny", table_id: "n_1", starts_at_local: "2027-09-23T19:00" }));
  await step("no-op patch", 0, () => h.patch(a.b.reference, { party_size: 2 }));
  await step("failed patch", 0, () => h.patch(a.b.reference, { party_size: 9 }));
  await step("real patch", 1, () => h.patch(a.b.reference, { party_size: 1 }));
  const b = await step("second booking", 1, () => h.book({ table_id: "t_3", starts_at_local: "2027-09-23T19:00" }));
  await step("moves batch with two real changes", 1, () => h.moves([{ reference: a.b.reference, starts_at_local: "2027-09-23T20:00" }, { reference: b.b.reference, starts_at_local: "2027-09-23T20:00" }]));
  await step("moves batch all no-op", 0, () => h.moves([{ reference: a.b.reference, party_size: 1 }]));
  await step("failed moves", 0, () => h.moves([{ reference: a.b.reference, table_id: "t_3" }]));
  await step("policy publication", 1, () => h.publish(policy(), "r_anker", "mgr", "rr-p"));
  await step("policy replay", 0, () => h.publish(policy(), "r_anker", "mgr", "rr-p"));
  await step("invalid policy", 0, () => h.publish(policy({ slot_minutes: 0 })));
  await step("series adoption (3 occurrences)", 1, () => h.series({ anchor_reference: b.b.reference, count: 3, interval_weeks: 1 }, "ada", "rr-s"));
  await step("series replay", 0, () => h.series({ anchor_reference: b.b.reference, count: 3, interval_weeks: 1 }, "ada", "rr-s"));
  await step("cancel", 1, () => h.cancel(a.b.reference));
  await step("repeated cancel", 0, () => h.cancel(a.b.reference));
  const ex = (await call("GET", "/_test/export")).b; await call("POST", "/_test/import", ex);
  await step("export/import keeps it", 0, async () => {});
  await step("reset clears it", -want, () => call("POST", "/_test/reset", fx()));
  return e.result();
});
