import { run, J, errs, policy, berlinDate, hours } from "./lib.mjs";
// Repair keeps times, party size and accepted terms; one `reassigned` entry per moved booking; unmoved gain nothing;
// cutoffs do not block; moved series member keeps its exception flag; series revision once per plan.
await run("f20-apply-effects", "Each moved booking increments its revision once and gains one `reassigned` history entry with a `table_ids` change and `plan_id`; accepted terms and times remain identical.", async (call, h) => {
  const e = errs();
  const D = berlinDate(1); // tomorrow: inside every booking's 120-min..7-day cutoff once the policy below applies
  await h.publish(policy({ effective_from: "2026-01-01", cancellation_cutoff_minutes: 10080, opening_hours: hours("00:00", "23:00") }));
  const a = await h.book({ table_id: "t_2", starts_at_local: `${D}T19:00`, party_size: 2 });
  const b = await h.book({ table_id: "t_3", starts_at_local: `${D}T19:00`, party_size: 2 });
  const s0 = await h.book({ table_id: "t_2", starts_at_local: "2027-09-16T19:00" });
  e.check(a.s === 201 && b.s === 201, `setup ${a.s}/${b.s} ${J(a.b)}`);
  const A0 = (await h.get(a.b.reference)).b, B0 = (await h.get(b.b.reference)).b;
  const p = await h.replan({ table_id: "t_2", from: `${D}T18:00:00+02:00`, to: `${D}T23:00:00+02:00` });
  e.check(p.s === 201 && p.b.moved_count === 1, `preview ${p.s} ${J(p.b)}`);
  e.check(J((await h.get(a.b.reference)).b) === J(A0), "preview changed a booking");
  const ap = await h.apply(p.b.plan_id);
  e.check(ap.s === 201, `apply despite diner cutoff ${ap.s} ${J(ap.b)}`);
  const A1 = (await h.get(a.b.reference)).b, B1 = (await h.get(b.b.reference)).b;
  const same = (x, y) => ["starts_at", "ends_at", "starts_at_local", "party_size", "reservation_id", "created_at", "status"].every((k) => J(x[k]) === J(y[k])) && J(x.accepted_terms) === J(y.accepted_terms);
  e.check(same(A0, A1) && A1.revision === A0.revision + 1 && !A1.table_ids.includes("t_2"), `moved booking ${J(A1)}`);
  e.check(J(B0) === J(B1), "unmoved considered booking changed");
  const H = (await h.hist(a.b.reference)).b.entries; const last = H[H.length - 1];
  e.check(H.length === 2 && last.event === "reassigned" && last.plan_id === p.b.plan_id && last.revision === A1.revision && J(last.changes) === J([{ field: "table_ids", from: ["t_2"], to: A1.table_ids }]), `reassigned entry ${J(last)}`);
  e.check((await h.hist(b.b.reference)).b.entries.length === 1, "unmoved booking gained history");
  e.check(J(ap.b.reservations.map((r) => r.reference)) === J([a.b.reference, b.b.reference].sort()), `apply reservations ${J(ap.b.reservations.map((r) => r.reference))}`);
  // series member moved by a repair: exception flag kept, series revision +1 once
  const s = await h.series({ anchor_reference: s0.b.reference, count: 3, interval_weeks: 1 });
  e.check(s.s === 201, `series ${s.s} ${J(s.b)}`);
  const o1 = s.b.occurrences[1].reference, o2 = s.b.occurrences[2].reference;
  await h.patch(o1, { party_size: 1 }); // exception, series revision 2
  await h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:00" }); await h.book({ table_id: "t_1", starts_at_local: "2027-09-30T19:00" });
  const S1 = (await h.getSeries(s.b.series_id)).b;
  const q = await h.replan({ table_id: "t_2", from: "2027-09-23T00:00:00+02:00", to: "2027-10-01T00:00:00+02:00" });
  e.check(q.s === 201 && q.b.moved_count === 2, `series repair preview ${q.s} ${J(q.b)}`);
  const qa = await h.apply(q.b.plan_id);
  const S2 = (await h.getSeries(s.b.series_id)).b;
  e.check(qa.s === 201 && S2.revision === S1.revision + 1, `series revision after plan ${S1.revision}->${S2.revision}`);
  e.check(S2.occurrences[1].exception === true && S2.occurrences[2].exception === false, `exception flags ${J(S2.occurrences.map((o) => o.exception))}`);
  e.check(S2.occurrences[2].reservation.starts_at_local === S1.occurrences[2].reservation.starts_at_local && J(S2.occurrences[2].reservation.accepted_terms) === J(S1.occurrences[2].reservation.accepted_terms), "moved occurrence date/terms changed");
  return e.result();
});
