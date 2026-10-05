import { run, J, errs } from "./lib.mjs";
await run("f2-closure-occupancy", "Closures thereafter exclude singles and pairs from availability and reject creates/amendments with 409 `table_unavailable`.", async (call, h) => {
  const e = errs();
  const D = "2027-09-23";
  const a = await h.book({ table_id: "t_2", starts_at_local: `${D}T19:00` });
  const b = await h.book({ table_id: "t_3", starts_at_local: `${D}T12:00` });
  const p = await h.replan({ table_id: "t_2", from: `${D}T19:00:00+02:00`, to: `${D}T21:00:00+02:00` });
  e.check(p.s === 201, `preview ${p.s} ${J(p.b)}`);
  const c0 = await h.book({ table_id: "t_2", starts_at_local: "2027-09-16T12:00" });
  const ser = await h.series({ anchor_reference: c0.b.reference, count: 2, interval_weeks: 1 });
  e.check(ser.s === 201, `series ${ser.s} ${J(ser.b)}`);
  const p2 = await h.replan({ table_id: "t_2", from: `${D}T19:00:00+02:00`, to: `${D}T21:00:00+02:00` });
  const ap2 = await h.apply(p2.b.plan_id); e.check(ap2.s === 201, `apply ${ap2.s} ${J(ap2.b)}`);
  const A = (await h.get(a.b.reference)).b;
  e.check(!A.table_ids.includes("t_2"), `booking on closed table not moved ${J(A.table_ids)}`);
  const slot = async (hm, ps = 1, extra = "") => (await h.avail(D, ps, "r_anker", extra)).slots.find((s) => s.starts_at_local === `${D}T${hm}`);
  for (const hm of ["18:00", "19:00", "20:30"]) {
    const s = await slot(hm);
    e.check(!s.available_table_ids.includes("t_2"), `${hm}: t_2 listed while closed`);
    e.check(!s.available_options.some((o) => o.table_ids.includes("t_2")), `${hm}: option with t_2 listed while closed ${J(s.available_options)}`);
    const x = (await slot(hm, 1, "&explain=true")).explain.find((q) => q.table_id === "t_2");
    e.check(x && x.available === false && J(x.rules) === J([{ rule: "capacity", holds: true }, { rule: "no_overlap", holds: false }]), `${hm}: explain t_2 ${J(x)}`);
  }
  const s21 = await slot("21:00");
  e.check(s21.available_table_ids.includes("t_2"), "21:00 (closure end, half-open) t_2 not offered");
  const s1730 = await slot("17:30");
  e.check(s1730.available_table_ids.includes("t_2"), "17:30+90=19:00 ends at closure start (half-open) but t_2 not offered");
  const want409 = async (what, r) => e.check(r.s === 409 && r.b?.error?.code === "table_unavailable", `${what}: ${r.s} ${r.b?.error?.code}`);
  await want409("create single", await h.book({ table_id: "t_2", starts_at_local: `${D}T20:00` }));
  await want409("create pair", await h.book({ table_ids: ["t_1", "t_2"], starts_at_local: `${D}T19:30`, party_size: 3 }));
  await want409("patch onto closed", await h.patch(b.b.reference, { table_id: "t_2", starts_at_local: `${D}T19:00` }));
  await want409("moves onto closed", await h.moves([{ reference: b.b.reference, table_ids: ["t_2", "t_3"], starts_at_local: `${D}T20:00` }]));
  const ok = await h.book({ table_id: "t_2", starts_at_local: `${D}T21:00` });
  e.check(ok.s === 201, `booking at closure end ${ok.s}`);
  // series amend moving occurrence 1 (on t_2, same day) into the closure
  const am = await h.amend(ser.b.series_id, { expected_revision: 1, from_index: 1, local_time: "19:30" });
  e.check(am.s === 409 && am.b?.error?.code === "table_unavailable", `series amend into closure ${am.s} ${J(am.b)}`);
  // adoption whose occurrence falls in the closure
  const d0 = await h.book({ table_id: "t_2", starts_at_local: "2027-09-16T19:30" });
  const ad = await h.series({ anchor_reference: d0.b.reference, count: 2, interval_weeks: 1 });
  e.check(ad.s === 409 && ad.b?.error?.code === "table_unavailable", `adoption into closure ${ad.s} ${J(ad.b)}`);
  // a closure at another restaurant changes nothing here
  const ny = await h.book({ restaurant_id: "r_ny", table_id: "n_1", starts_at_local: `${D}T19:00` });
  e.check(ny.s === 201, "other restaurant booking");
  return e.result();
});
