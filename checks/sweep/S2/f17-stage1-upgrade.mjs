import { startServer, fx, J } from "./lib.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
const quote = "A stage-2 service must accept an export produced by the same team's stage-1 service.";
const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
const d2 = [join(arg, "stage-2"), arg].find((d) => existsSync(join(d, "src", "server.ts")));
const d1 = process.env.STAGE1_DIR || [join(arg, "stage-1"), join(arg, "..", "stage-1")].find((d) => existsSync(join(d, "src", "server.ts")));
let res = true, s1, s2;
try {
  s1 = await startServer(d1);
  const f = fx(); delete f.restaurants[0].combinable;
  f.reservations = [{ id: "res_seed", reference: "SEEDAA", user_id: "u_bob", restaurant_id: "r_anker", table_id: "t_3", starts_at_local: "2027-09-23T19:00", party_size: 2 }];
  if ((await s1.call("POST", "/_test/reset", f)).s !== 204) throw new Error("stage-1 reset");
  const tok = (await s1.call("POST", "/auth/login", { email: "ada@example.com", password: "correct horse" })).b.token;
  const A = { authorization: `Bearer ${tok}` };
  const body = { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2027-09-23T19:00", party_size: 2 };
  const orig = await s1.call("POST", "/reservations", body, { ...A, "idempotency-key": "up-1" });
  const mv = await s1.call("POST", "/reservation-moves", { moves: [{ reference: orig.b.reference, party_size: 3 }] }, { ...A, "idempotency-key": "up-mv" });
  const ex = (await s1.call("GET", "/_test/export")).b;
  s2 = await startServer(d2);
  const im = await s2.call("POST", "/_test/import", ex);
  const e = [];
  if (im.s !== 204) e.push(`import ${im.s} ${J(im.b)}`);
  else {
    const rp = await s2.call("POST", "/reservations", body, { ...A, "idempotency-key": "up-1" });
    if (rp.s !== 200 || J(rp.b) !== J(orig.b)) e.push(`create replay after upgrade ${rp.s} ${J(rp.b)} vs ${J(orig.b)}`);
    const mr = await s2.call("POST", "/reservation-moves", { moves: [{ reference: orig.b.reference, party_size: 3 }] }, { ...A, "idempotency-key": "up-mv" });
    if (mr.s !== 200 || J(mr.b) !== J(mv.b)) e.push(`moves replay after upgrade ${mr.s}`);
    const g = await s2.call("GET", `/reservations/${orig.b.reference}`, undefined, A);
    if (g.s !== 200 || J(g.b.table_ids) !== J(["t_2"]) || g.b.table_id !== "t_2") e.push(`old token GET ${g.s} ${J(g.b)}`);
    if ((await s2.call("POST", "/auth/login", { email: "ada@example.com", password: "correct horse" })).s !== 200) e.push("login after upgrade");
    const av = (await s2.call("GET", "/availability?restaurant_id=r_anker&date=2027-09-23&party_size=1")).b;
    const s = av?.slots?.find((q) => q.starts_at_local === "2027-09-23T19:00");
    if (!s || J(s.available_table_ids) !== J(["t_1"]) || J(s.available_options) !== J([{ table_ids: ["t_1"], capacity: 2 }])) e.push(`availability after upgrade ${J(s)}`);
    if ((await s2.call("GET", "/reservations/SEEDAA", undefined, A)).s !== 404) e.push("other user's imported booking visible");
    const c = await s2.call("POST", `/reservations/${orig.b.reference}/cancel`, {}, A);
    if (c.s !== 200 || J(c.b.table_ids) !== J(["t_2"])) e.push(`cancel imported ${c.s} ${J(c.b)}`);
    const nb = await s2.call("POST", "/reservations", { restaurant_id: "r_anker", table_id: "t_1", starts_at_local: "2027-09-23T21:00", party_size: 1 }, { ...A, "idempotency-key": "up-new" });
    if (nb.s !== 201 || nb.b.reference === orig.b.reference) e.push(`new booking after upgrade ${nb.s}`);
  }
  if (e.length) res = e.join("; ");
} catch (err) { res = `error ${err.message}`; }
finally { s1?.stop(); s2?.stop(); }
console.log(res === true ? `PASS S2 f17-stage1-upgrade | "${quote}"` : `FAIL S2 f17-stage1-upgrade | ${res} | "${quote}"`);
process.exit(res === true ? 0 : 1);
