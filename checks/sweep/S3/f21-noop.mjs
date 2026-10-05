import { run, J, errs } from "./lib.mjs";
await run("f21-noop", "A no-op amendment retains terms, end time and revision and records no history.", async (call, h) => {
  const e = errs();
  const a = await h.book({ table_ids: ["t_1", "t_2"], starts_at_local: "2027-09-23T19:00", party_size: 4 });
  const b = await h.book({ table_id: "t_3", starts_at_local: "2027-09-23T19:00" });
  const before = async (ref) => J((await h.get(ref)).b);
  const A0 = await before(a.b.reference), B0 = await before(b.b.reference);
  const n1 = await h.patch(a.b.reference, { table_ids: ["t_2", "t_1"] });
  e.check(n1.s === 200, `reversed pair patch ${n1.s}`);
  const n2 = await h.patch(a.b.reference, { party_size: 4, starts_at_local: "2027-09-23T19:00" });
  e.check(n2.s === 200, `same-value patch ${n2.s}`);
  const n3 = await h.patch(b.b.reference, { table_ids: ["t_3"] });
  e.check(n3.s === 200, `table_ids [t_3] == table_id t_3 patch ${n3.s}`);
  const m = await h.moves([{ reference: a.b.reference, table_ids: ["t_2", "t_1"] }, { reference: b.b.reference, party_size: 2 }]);
  e.check(m.s === 201, `no-op moves ${m.s} ${J(m.b)}`);
  e.check(await before(a.b.reference) === A0, `pair booking changed by no-ops ${await before(a.b.reference)}`);
  e.check(await before(b.b.reference) === B0, "single booking changed by no-ops");
  e.check((await h.hist(a.b.reference)).b.entries.length === 1 && (await h.hist(b.b.reference)).b.entries.length === 1, "no-op recorded history");
  // series: a no-op PATCH on an occurrence is not an exception and does not bump series revision
  const s = await h.series({ anchor_reference: b.b.reference, count: 2, interval_weeks: 1 });
  e.check(s.s === 201, `series ${s.s} ${J(s.b)}`);
  if (s.s === 201) {
    const occ = s.b.occurrences[1].reference;
    await h.patch(occ, { party_size: 2 });
    const g = (await call("GET", `/series/${s.b.series_id}`, undefined, h.auth(await h.login()))).b;
    e.check(g.revision === 1 && g.occurrences.every((o) => o.exception === false), `no-op occurrence patch: series ${g.revision} ${J(g.occurrences.map((o) => o.exception))}`);
    // a real one does both, once
    await h.patch(occ, { party_size: 1 });
    const g2 = (await call("GET", `/series/${s.b.series_id}`, undefined, h.auth(await h.login()))).b;
    e.check(g2.revision === 2 && g2.occurrences[1].exception === true, `real occurrence patch: series ${g2.revision} ${g2.occurrences[1].exception}`);
    await h.cancel(s.b.occurrences[0].reference); await h.cancel(s.b.occurrences[0].reference);
    const g3 = (await call("GET", `/series/${s.b.series_id}`, undefined, h.auth(await h.login()))).b;
    e.check(g3.revision === 3 && g3.occurrences[0].exception === false && g3.occurrences[1].reservation.status === "confirmed", `cancel anchor: series ${g3.revision} exc ${g3.occurrences[0].exception}`);
  }
  return e.result();
});
