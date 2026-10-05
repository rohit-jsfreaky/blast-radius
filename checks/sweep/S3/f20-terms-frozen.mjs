import { run, J, errs, policy, berlinDate, helpers, fx } from "./lib.mjs";
await run("f20-terms-frozen", "A policy publication does not change existing bookings, their end times, or their history.", async (call, h0) => {
  let h = h0;
  const e = errs();
  // occupancy and end time keep the accepted duration
  const k = "tf-1";
  const body = { table_id: "t_2", starts_at_local: "2027-09-23T19:00" };
  const a = await h.book(body, "ada", k);
  await h.publish(policy({ effective_from: "2027-09-01", reservation_duration_minutes: 100, cancellation_cutoff_minutes: 10080 }));
  const g = (await h.get(a.b.reference)).b;
  e.check(g.ends_at === a.b.ends_at && g.revision === 1 && g.accepted_terms.policy_version === 0, `existing booking changed ${J(g)}`);
  e.check((await h.hist(a.b.reference)).b.entries.length === 1, "publication added history");
  const b = await h.book({ table_id: "t_2", starts_at_local: "2027-09-23T20:30" });
  e.check(b.s === 201, `20:30 on t_2 must be free (accepted end 20:30, not 19:00+100), got ${b.s} ${J(b.b)}`);
  // real amendment adopts the resulting date's policy once
  const p = await h.patch(a.b.reference, { party_size: 3, starts_at_local: "2027-09-23T15:00" });
  e.check(p.s === 200 && p.b.accepted_terms.policy_version === 1 && p.b.ends_at === "2027-09-23T16:40:00+02:00" && p.b.revision === 2, `amend ${p.s} ${J(p.b)}`);
  const hs = (await h.hist(a.b.reference)).b.entries;
  e.check(hs[0].accepted_terms.policy_version === 0 && hs[1].accepted_terms.policy_version === 1, "old history entry acquired new terms");
  const r = await h.book(body, "ada", k);
  e.check(r.s === 200 && J(r.b) === J(a.b), "replay lost original terms");
  // cancel uses the ACCEPTED cutoff: booked under 120 min, new policy says 7 days
  await call("POST", "/_test/reset", fx());
  h = helpers(call);
  const d = berlinDate(2);
  const c = await h.book({ table_id: "t_1", starts_at_local: `${d}T12:00` });
  e.check(c.s === 201, `near booking ${c.s} ${J(c.b)}`);
  await h.publish(policy({ effective_from: "2026-01-01", cancellation_cutoff_minutes: 10080 }));
  const x = await h.cancel(c.b.reference);
  e.check(x.s === 200, `cancel under accepted 120-min cutoff refused: ${x.s} ${J(x.b)}`);
  const c2 = await h.book({ table_id: "t_2", starts_at_local: `${d}T12:00` });
  const x2 = await h.patch(c2.b.reference, { party_size: 1 });
  e.check(x2.s === 409 && x2.b?.error?.code === "cutoff_passed", `booking accepted under 7-day cutoff should refuse change: ${x2.s}`);
  return e.result();
});
