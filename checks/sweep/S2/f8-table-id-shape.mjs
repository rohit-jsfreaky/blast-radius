import { run, J } from "./lib.mjs";
const chk = (where, o, set) => {
  if (J(o?.table_ids) !== J(set)) return `${where}: table_ids ${J(o?.table_ids)} want ${J(set)}`;
  if (set.length === 1 ? o.table_id !== set[0] : "table_id" in o) return `${where}: table_id ${J(o.table_id)} for set ${J(set)}`;
  return null;
};
await run("f8-table-id-shape", "Responses always carry `table_ids`. They also carry `table_id` **when the set has exactly one member**, and omit it otherwise.", async (call, h) => {
  const t = await h.login();
  const key = "shape-pair";
  const body = { restaurant_id: "r_anker", table_ids: ["t_2", "t_1"], starts_at_local: "2027-09-23T19:00", party_size: 5 };
  const p = await h.book(t, body, key);
  const s = await h.book(t, { restaurant_id: "r_anker", table_id: "t_3", starts_at_local: "2027-09-23T19:00", party_size: 2 });
  if (p.s !== 201 || s.s !== 201) return `create ${p.s}/${s.s} ${J(p.b)}`;
  const pair = ["t_1", "t_2"];
  const errs = [chk("create pair (reversed input)", p.b, pair), chk("create single", s.b, ["t_3"]),
    chk("replay pair", (await h.book(t, body, key)).b, pair),
    chk("get pair", (await call("GET", `/reservations/${p.b.reference}`, undefined, h.auth(t))).b, pair),
    chk("get single", (await call("GET", `/reservations/${s.b.reference}`, undefined, h.auth(t))).b, ["t_3"])];
  const list = (await call("GET", "/reservations", undefined, h.auth(t))).b.reservations;
  errs.push(chk("list pair", list.find((x) => x.reference === p.b.reference), pair), chk("list single", list.find((x) => x.reference === s.b.reference), ["t_3"]));
  const pt = await call("PATCH", `/reservations/${s.b.reference}`, { table_ids: ["t_3", "t_2"], starts_at_local: "2027-09-23T21:00", party_size: 6 }, h.auth(t));
  errs.push(pt.s === 200 ? chk("patch single->pair", pt.b, ["t_2", "t_3"]) : `patch ${pt.s} ${J(pt.b)}`);
  const pb = await call("PATCH", `/reservations/${s.b.reference}`, { table_id: "t_3", party_size: 2 }, h.auth(t));
  errs.push(pb.s === 200 ? chk("patch pair->single", pb.b, ["t_3"]) : `patch back ${pb.s} ${J(pb.b)}`);
  const mv = await call("POST", "/reservation-moves", { moves: [{ reference: s.b.reference, table_ids: ["t_3", "t_2"], starts_at_local: "2027-09-23T21:00" }] }, h.auth(t, "shape-mv"));
  errs.push(mv.s === 201 ? chk("moves single->pair", mv.b.reservations[0], ["t_2", "t_3"]) : `moves ${mv.s} ${J(mv.b)}`);
  errs.push(chk("cancel pair", (await call("POST", `/reservations/${p.b.reference}/cancel`, {}, h.auth(t))).b, pair));
  const e = errs.filter(Boolean); return e.length ? e.join("; ") : true;
});
