import { run, J } from "./lib.mjs";
await run("f2-patch-moves-pair", "No table may belong to overlapping resulting bookings.", async (call, h) => {
  const t = await h.login(); const e = [];
  const a = await h.book(t, { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2027-09-23T19:00", party_size: 2 });
  const b = await h.book(t, { restaurant_id: "r_anker", table_id: "t_3", starts_at_local: "2027-09-23T19:00", party_size: 2 });
  const p = await call("PATCH", `/reservations/${a.b.reference}`, { table_ids: ["t_1", "t_2"], party_size: 5 }, h.auth(t));
  if (p.s !== 200) e.push(`patch into pair over own slot ${p.s} ${J(p.b)}`);
  const q = await call("PATCH", `/reservations/${a.b.reference}`, { table_ids: ["t_2", "t_3"] }, h.auth(t));
  if (q.s !== 409) e.push(`patch into held member ${q.s}`);
  const m = await call("POST", "/reservation-moves", { moves: [{ reference: a.b.reference, table_ids: ["t_2", "t_3"] }, { reference: b.b.reference, table_id: "t_1" }] }, h.auth(t, "mv-ok"));
  if (m.s !== 201) e.push(`swap via moves ${m.s} ${J(m.b)}`);
  const before = J((await call("GET", "/reservations", undefined, h.auth(t))).b);
  const m2 = await call("POST", "/reservation-moves", { moves: [{ reference: b.b.reference, table_id: "t_2" }] }, h.auth(t, "mv-bad"));
  if (m2.s !== 409) e.push(`move onto pair member ${m2.s}`);
  const m3 = await call("POST", "/reservation-moves", { moves: [{ reference: a.b.reference, table_ids: ["t_1", "t_2"] }, { reference: b.b.reference, table_ids: ["t_2", "t_3"] }] }, h.auth(t, "mv-bad2"));
  if (m3.s !== 409) e.push(`two resulting pairs sharing t_2 ${m3.s}`);
  if (J((await call("GET", "/reservations", undefined, h.auth(t))).b) !== before) e.push("failed move changed state");
  return e.length ? e.join("; ") : true;
});
