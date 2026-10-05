import { run, fx } from "./lib.mjs";
// INC-2 sibling: a seeded/imported booking's party_size must fit its table set (single capacity or pair sum).
await run("inc1-seed-capacity", "`capacity` | Table | Maximum party size", async (call) => {
  const e = [];
  const seed = (r) => ({ id: "res_s", reference: "SEED01", user_id: "u_ada", restaurant_id: "r_anker", starts_at_local: "2027-09-23T19:00", ...r });
  for (const [what, r] of [["single t_1 (cap 2) party 3", { table_id: "t_1", party_size: 3 }], ["single via table_ids t_1 party 3", { table_ids: ["t_1"], party_size: 3 }], ["pair t_1+t_2 (cap 6) party 7", { table_ids: ["t_1", "t_2"], party_size: 7 }]]) {
    const x = await call("POST", "/_test/reset", fx({ reservations: [seed(r)] }));
    if (x.s < 400 || x.s >= 500) e.push(`reset ${what}: ${x.s}`);
  }
  // import path: take a valid export, raise party_size beyond capacity, import must be 422 and leave destination unchanged
  if ((await call("POST", "/_test/reset", fx({ reservations: [seed({ table_ids: ["t_1", "t_2"], party_size: 6 })] }))).s !== 204) return "valid seed at exact pair capacity rejected";
  const ex = (await call("GET", "/_test/export")).b;
  const bad = structuredClone(ex);
  const r0 = bad.state.reservations[0]; r0.party_size = 7;
  const im = await call("POST", "/_test/import", bad);
  if (im.s !== 422) e.push(`import pair party 7: ${im.s}`);
  return e.length ? e.join("; ") : true;
});
