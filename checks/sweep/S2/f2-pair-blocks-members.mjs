import { run, J } from "./lib.mjs";
await run("f2-pair-blocks-members", "The booking occupies both tables for its full duration.", async (call, h) => {
  const t = await h.login();
  const r = await h.book(t, { restaurant_id: "r_anker", table_ids: ["t_1", "t_2"], starts_at_local: "2027-09-23T19:00", party_size: 5 });
  if (r.s !== 201) return `pair create ${r.s} ${J(r.b)}`;
  for (const [tid, at] of [["t_1", "19:30"], ["t_2", "18:00"]]) {
    const x = await h.book(t, { restaurant_id: "r_anker", table_id: tid, starts_at_local: `2027-09-23T${at}`, party_size: 1 });
    if (x.s !== 409 || x.b?.error?.code !== "table_unavailable") return `single ${tid}@${at} overlapping a pair member gave ${x.s} ${J(x.b)}`;
  }
  const y = await h.book(t, { restaurant_id: "r_anker", table_ids: ["t_2", "t_3"], starts_at_local: "2027-09-23T20:00", party_size: 5 });
  if (y.s !== 409) return `pair sharing t_2 gave ${y.s}`;
  const s = (await h.slot("2027-09-23", 1)).find((q) => q.starts_at_local === "2027-09-23T19:00");
  if (s.available_table_ids.includes("t_1") || s.available_table_ids.includes("t_2")) return `availability still lists members ${J(s.available_table_ids)}`;
  if ((s.available_options || []).some((o) => o.table_ids.includes("t_1") || o.table_ids.includes("t_2"))) return `options still list members ${J(s.available_options)}`;
  const z = (await h.slot("2027-09-23", 1)).find((q) => q.starts_at_local === "2027-09-23T20:30");
  return z.available_table_ids.includes("t_1") && z.available_table_ids.includes("t_2") ? true : `half-open end: 20:30 should be free ${J(z)}`;
});
