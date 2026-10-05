import { run, J } from "./lib.mjs";
await run("f12-cancel-frees-pair", "Cancelling frees every table in the set.", async (call, h) => {
  const t = await h.login();
  const r = await h.book(t, { restaurant_id: "r_anker", table_ids: ["t_1", "t_2"], starts_at_local: "2027-09-23T19:00", party_size: 5 });
  if (r.s !== 201) return `pair create ${r.s}`;
  const c = await call("POST", `/reservations/${r.b.reference}/cancel`, {}, h.auth(t));
  if (c.s !== 200) return `cancel ${c.s} ${J(c.b)}`;
  const s = (await h.slot("2027-09-23", 1)).find((q) => q.starts_at_local === "2027-09-23T19:00");
  if (J(s.available_table_ids) !== J(["t_1", "t_2", "t_3"])) return `after cancel ${J(s.available_table_ids)}`;
  const x = await h.book(t, { restaurant_id: "r_anker", table_id: "t_1", starts_at_local: "2027-09-23T19:00", party_size: 1 });
  const y = await h.book(t, { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2027-09-23T19:00", party_size: 1 });
  return x.s === 201 && y.s === 201 ? true : `rebook members ${x.s}/${y.s}`;
});
