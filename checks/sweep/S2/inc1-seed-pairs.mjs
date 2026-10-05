import { run, J, fx } from "./lib.mjs";
await run("inc1-seed-pairs", "Each entry is an unordered pair of table ids in that restaurant. **Pairs only**", async (call, h) => {
  const e = [];
  const seed = (r) => ({ id: "res_s", reference: "SEED01", user_id: "u_ada", restaurant_id: "r_anker", starts_at_local: "2027-09-23T19:00", party_size: 2, ...r });
  const rej = async (what, f) => { const r = await call("POST", "/_test/reset", f); if (r.s < 400 || r.s >= 500) e.push(`${what}: reset ${r.s}`); };
  await rej("seeded undeclared pair t_1+t_3", fx({ reservations: [seed({ table_ids: ["t_1", "t_3"] })] }));
  await rej("seeded three tables", fx({ reservations: [seed({ table_ids: ["t_1", "t_2", "t_3"] })] }));
  await rej("seeded both table_id and table_ids", fx({ reservations: [seed({ table_id: "t_1", table_ids: ["t_1", "t_2"] })] }));
  await rej("seeded pair overlapping a seeded single on a member", fx({ reservations: [seed({ table_ids: ["t_1", "t_2"] }), seed({ id: "res_t", reference: "SEED02", table_id: "t_2", starts_at_local: "2027-09-23T20:00" })] }));
  const bad = (c) => { const f = fx(); f.restaurants[0].combinable = c; return f; };
  await rej("combinable names foreign table", bad([["t_1", "t_9"]]));
  await rej("combinable triple", bad([["t_1", "t_2", "t_3"]]));
  await rej("combinable self pair", bad([["t_1", "t_1"]]));
  await rej("combinable non-array entry", bad(["t_1"]));
  const ok = await call("POST", "/_test/reset", fx({ reservations: [seed({ table_ids: ["t_2", "t_1"], status: "cancelled" }), seed({ id: "res_t", reference: "SEED02", table_id: "t_2" })] }));
  if (ok.s !== 204) e.push(`valid seed (cancelled pair + confirmed single) rejected ${ok.s} ${J(ok.b)}`);
  else { const s = (await h.slot()).find((q) => q.starts_at_local === "2027-09-23T19:00"); if (J(s.available_table_ids) !== J(["t_1", "t_3"])) e.push(`cancelled seed occupies? ${J(s.available_table_ids)}`); }
  return e.length ? e.join("; ") : true;
});
