import { run, J, errs, policy, fx } from "./lib.mjs";
await run("series-amend", "Consider indices at or after from_index, excluding cancelled occurrences and those marked exception. Change their clock time on their original scheduled local dates", async (call, h0) => {
  const e = errs();
  let h = h0;
  const T = async (o) => (await h.get(o)).b;
  const mk = async (count = 5, start = "2027-09-02T19:00", table = "t_2") => {
    const a = await h.book({ table_id: table, starts_at_local: start });
    return (await h.series({ anchor_reference: a.b.reference, count, interval_weeks: 1 }, "ada", h.key())).b;
  };
  const s = await mk();
  const occ = s.occurrences.map((o) => o.reference);
  await h.patch(occ[2], { starts_at_local: "2027-09-16T20:30" }); // exception, series rev 2
  await h.cancel(occ[3]); // series rev 3
  const S = (await h.getSeries(s.series_id)).b;
  e.check(S.revision === 3, `setup revision ${S.revision}`);
  const rr0 = await h.rrev();
  // validation and stale_revision precedence
  for (const [what, b, code] of [["revision 0", { expected_revision: 0, from_index: 0, local_time: "20:00" }, 422], ["bool index", { expected_revision: 3, from_index: true, local_time: "20:00" }, 422],
    ["index = count", { expected_revision: 3, from_index: 5, local_time: "20:00" }, 422], ["24:00", { expected_revision: 3, from_index: 0, local_time: "24:00" }, 422], ["9:00", { expected_revision: 3, from_index: 0, local_time: "9:00" }, 422],
    ["seconds", { expected_revision: 3, from_index: 0, local_time: "20:00:00" }, 422], ["stale beats invalid time", { expected_revision: 2, from_index: 0, local_time: "03:00" }, 409]]) {
    const r = await h.amend(s.series_id, b); e.check(r.s === code, `${what}: ${r.s} ${r.b?.error?.code}`);
  }
  e.check((await h.amend(s.series_id, { expected_revision: 3, from_index: 0, local_time: "20:00" }, "bob")).s === 404, "other owner not 404");
  e.check((await call("POST", `/series/${s.series_id}/amend`, { expected_revision: 3, from_index: 0, local_time: "20:00" }, { "idempotency-key": "z" })).s === 401, "no token not 401");
  e.check((await h.amend("ser_nope", { expected_revision: 3, from_index: 0, local_time: "20:00" })).s === 404, "unknown series not 404");
  // real amend from index 1
  const before = await Promise.all(occ.map(T));
  const r = await h.amend(s.series_id, { expected_revision: 3, from_index: 1, local_time: "20:00" }, "ada", "am-1");
  e.check(r.s === 201 && r.b.revision === 4, `amend ${r.s} rev ${r.b?.revision} ${J(r.b).slice(0, 200)}`);
  const after = await Promise.all(occ.map(T));
  e.check(J(after[0]) === J(before[0]), "index 0 (before from_index) changed");
  e.check(after[1].starts_at_local === "2027-09-09T20:00" && after[1].revision === before[1].revision + 1, `occ1 ${after[1].starts_at_local} rev ${after[1].revision}`);
  e.check(J(after[2]) === J(before[2]), "exception occurrence changed");
  e.check(J(after[3]) === J(before[3]), "cancelled occurrence changed");
  e.check(after[4].starts_at_local === "2027-09-30T20:00", `occ4 ${after[4].starts_at_local}`);
  const G = (await h.getSeries(s.series_id)).b;
  e.check(G.occurrences.map((o) => o.exception).join() === "false,false,true,false,false", `amend marked exceptions ${J(G.occurrences.map((o) => o.exception))}`);
  e.check(await h.rrev() === rr0 + 1, `restaurant revision ${await h.rrev()} want ${rr0 + 1}`);
  const hs = (await h.hist(occ[1])).b.entries;
  e.check(hs[hs.length - 1].event === "changed" && J(hs[hs.length - 1].changes) === J([{ field: "starts_at_local", from: "2027-09-09T19:00", to: "2027-09-09T20:00" }]), `occ1 history ${J(hs[hs.length - 1])}`);
  // replay after later edits returns the original
  await h.cancel(occ[4]);
  const rp = await h.amend(s.series_id, { expected_revision: 3, from_index: 1, local_time: "20:00" }, "ada", "am-1");
  e.check(rp.s === 200 && J(rp.b) === J(r.b), `replay ${rp.s}`);
  // all-no-op: nothing changes
  const rr1 = await h.rrev(); const g1 = (await h.getSeries(s.series_id)).b;
  const n = await h.amend(s.series_id, { expected_revision: g1.revision, from_index: 1, local_time: "20:00" });
  const g2 = (await h.getSeries(s.series_id)).b;
  e.check(n.s === 201 && g2.revision === g1.revision && await h.rrev() === rr1 && (await T(occ[1])).revision === after[1].revision, `all-no-op changed revisions ${g1.revision}->${g2.revision}`);
  // failure is atomic: conflict on the last eligible occurrence
  await call("POST", "/_test/reset", fx()); h = (await import("./lib.mjs")).h4(call);
  const s2 = await mk(3);
  await h.book({ table_id: "t_2", starts_at_local: "2027-09-16T21:00" }, "bob");
  const ex0 = J((await call("GET", "/_test/export")).b.state.reservations), rr2 = await h.rrev();
  const f = await h.amend(s2.series_id, { expected_revision: 1, from_index: 0, local_time: "20:00" }, "ada", "am-f");
  e.check(f.s === 409 && f.b?.error?.code === "table_unavailable", `conflict ${f.s} ${J(f.b)}`);
  e.check(J((await call("GET", "/_test/export")).b.state.reservations) === ex0 && await h.rrev() === rr2 && (await h.getSeries(s2.series_id)).b.revision === 1, "failed amend changed state");
  const f2 = await h.amend(s2.series_id, { expected_revision: 1, from_index: 0, local_time: "18:00" }, "ada", "am-f");
  e.check(f2.s === 201, `failed key reusable ${f2.s}`);
  // DST: Berlin 2027-03-28 02:30 does not exist
  const s3 = await mk(2, "2027-03-21T01:00", "t_3");
  const d = await h.amend(s3.series_id, { expected_revision: 1, from_index: 0, local_time: "02:30" });
  e.check(d.s === 422 && d.b?.error?.code === "invalid_local_time", `DST gap ${d.s} ${J(d.b)}`);
  // policy for the resulting date: a later policy forbids 22:00 (closes 22:00)
  const s4 = await mk(2, "2027-11-04T19:00", "t_1");
  await h.publish(policy({ effective_from: "2027-11-10", opening_hours: [{ weekday: "thu", opens: "10:00", closes: "21:00" }] }));
  const q = await h.amend(s4.series_id, { expected_revision: 1, from_index: 0, local_time: "20:00" });
  e.check(q.s === 422 && q.b?.error?.code === "outside_opening_hours", `resulting-date policy ${q.s} ${J(q.b)}`);
  // concurrency: same expected revision, different times -> at most one real change
  const s5 = await mk(2, "2027-12-02T12:00", "t_3");
  const par = await Promise.all(["13:00", "14:00", "15:00", "16:00"].map((t) => h.amend(s5.series_id, { expected_revision: 1, from_index: 0, local_time: t })));
  e.check(par.filter((x) => x.s === 201).length === 1 && par.filter((x) => x.b?.error?.code === "stale_revision").length === 3, `concurrent amends ${J(par.map((x) => x.s))}`);
  return e.result();
});
