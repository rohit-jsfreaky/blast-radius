import { startServer, fx, J, policy, helpers, stageDir, h4 } from "./lib.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
// Stage 1-3 exports import into stage 4 (with series incl. moved and cancelled occurrences, which then support amend
// and replans); a stage-4 export round-trips plans, closures and receipts; imported plans/closures are integrity-checked.
const quote = "A stage-4 service must accept exports produced by the same team's stages 1–3. These operations must support imported series, including moved and cancelled occurrences.";
const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
const d4 = stageDir();
const e = []; const servers = [];
const D = "2027-09-23";
try {
  for (const st of ["stage-1", "stage-2", "stage-3"]) {
    const d = [join(arg, st), join(arg, "..", st)].find((x) => existsSync(join(x, "src", "server.ts")));
    const old = await startServer(d); servers.push(old);
    const f = fx(); for (const r of f.restaurants) { if (st !== "stage-3") delete r.manager_user_ids; if (st === "stage-1") delete r.combinable; }
    if ((await old.call("POST", "/_test/reset", f)).s !== 204) throw new Error(`${st} reset`);
    const ho = helpers(old.call);
    const body = { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: `${D}T19:00`, party_size: 2 };
    const tok = await ho.login();
    const orig = await old.call("POST", "/reservations", body, ho.auth(tok, "up"));
    let ser = null;
    if (st === "stage-3") {
      const a = await ho.book({ table_id: "t_2", starts_at_local: "2027-09-02T12:00" });
      ser = (await ho.series({ anchor_reference: a.b.reference, count: 4, interval_weeks: 1 }, "ada", "up-s")).b;
      await ho.patch(ser.occurrences[1].reference, { table_id: "t_3" }); // moved -> exception
      await ho.cancel(ser.occurrences[2].reference);
    }
    const ex = (await old.call("GET", "/_test/export")).b;
    const s4 = await startServer(d4); servers.push(s4);
    const im = await s4.call("POST", "/_test/import", ex);
    if (im.s !== 204) { e.push(`${st} import ${im.s} ${J(im.b)}`); continue; }
    const h = h4(s4.call);
    const rp = await s4.call("POST", "/reservations", body, h.auth(tok, "up"));
    if (rp.s !== 200 || J(rp.b) !== J(orig.b)) e.push(`${st}: replay after upgrade ${rp.s}`);
    if (st !== "stage-3") { // imported restaurants have no managers: publish is 403, so no replan either
      const pr = await s4.call("POST", "/restaurants/r_anker/replans", { table_id: "t_2", from: `${D}T19:00:00+02:00`, to: `${D}T20:00:00+02:00` }, { authorization: `Bearer ${tok}`, "idempotency-key": "rp" });
      if (pr.s !== 403) e.push(`${st}: replan by non-manager after import ${pr.s}`);
    } else {
      const mtok = (await s4.call("POST", "/auth/login", { email: "mgr@example.com", password: "correct horse" })).b.token;
      const p = await s4.call("POST", "/restaurants/r_anker/replans", { table_id: "t_2", from: `${D}T00:00:00+02:00`, to: `${D}T23:00:00+02:00` }, { authorization: `Bearer ${mtok}`, "idempotency-key": "rp" });
      if (p.s !== 201) e.push(`stage-3: replan over imported bookings ${p.s} ${J(p.b)}`);
      else { const a = await s4.call("POST", `/restaurants/r_anker/replans/${p.b.plan_id}/apply`, {}, { authorization: `Bearer ${mtok}`, "idempotency-key": "ap" }); if (a.s !== 201) e.push(`stage-3: apply over imported ${a.s} ${J(a.b)}`); }
      const g = (await s4.call("GET", `/series/${ser.series_id}`, undefined, h.auth(tok))).b;
      const am = await s4.call("POST", `/series/${ser.series_id}/amend`, { expected_revision: g.revision, from_index: 0, local_time: "13:00" }, h.auth(tok, "am"));
      if (am.s !== 201) e.push(`stage-3: amend imported series ${am.s} ${J(am.b)}`);
      else {
        const o = am.b.occurrences;
        if (o[1].reservation.starts_at_local !== ser.occurrences[1].reservation.starts_at_local) e.push("amend changed an imported exception occurrence");
        if (o[2].reservation.status !== "cancelled" || o[2].reservation.starts_at_local !== ser.occurrences[2].reservation.starts_at_local) e.push("amend changed an imported cancelled occurrence");
        if (o[3].reservation.starts_at_local !== "2027-09-23T13:00") e.push(`amend occ3 ${o[3].reservation.starts_at_local}`);
      }
      const sr = await s4.call("POST", "/series", { anchor_reference: ser.occurrences[0].reference, count: 4, interval_weeks: 1 }, h.auth(tok, "up-s"));
      if (sr.s !== 200 || J(sr.b) !== J(ser)) e.push(`stage-3 series receipt after import ${sr.s}`);
    }
  }
  // stage-4 round trip
  const a = await startServer(d4); servers.push(a);
  await a.call("POST", "/_test/reset", fx());
  const ha = h4(a.call);
  await ha.book({ table_id: "t_2", starts_at_local: `${D}T19:00` });
  const p = await ha.replan({ table_id: "t_2", from: `${D}T19:00:00+02:00`, to: `${D}T21:00:00+02:00` }, "r_anker", "mgr", "rt-p");
  const ap = await ha.apply(p.b.plan_id, "r_anker", "mgr", "rt-a");
  const open = await ha.replan({ table_id: "t_3", from: `${D}T19:00:00+02:00`, to: `${D}T21:00:00+02:00` }, "r_anker", "mgr", "rt-open");
  const ex = (await a.call("GET", "/_test/export")).b;
  const z = await startServer(d4); servers.push(z);
  if ((await z.call("POST", "/_test/import", ex)).s !== 204) e.push("stage-4 round trip import");
  const hz = h4(z.call);
  const mt = await hz.login("mgr");
  const r1 = await z.call("POST", `/restaurants/r_anker/replans/${p.b.plan_id}/apply`, {}, hz.auth(mt, "rt-a"));
  if (r1.s !== 200 || J(r1.b) !== J(ap.b)) e.push(`apply receipt after import ${r1.s}`);
  const r2 = await z.call("POST", `/restaurants/r_anker/replans/${p.b.plan_id}/apply`, {}, hz.auth(mt, "rt-b"));
  if (r2.b?.error?.code !== "plan_already_applied") e.push(`applied flag after import ${r2.s} ${r2.b?.error?.code}`);
  const b = await hz.book({ table_id: "t_2", starts_at_local: `${D}T20:00` });
  if (b.s !== 409) e.push(`closure lost by import: booking on closed table ${b.s}`);
  const r3 = await z.call("POST", `/restaurants/r_anker/replans/${open.b.plan_id}/apply`, {}, hz.auth(mt, "rt-c"));
  if (r3.s !== 201) e.push(`open plan after import (no intervening write) ${r3.s} ${r3.b?.error?.code}`);
  const pr = await z.call("POST", "/restaurants/r_anker/replans", { table_id: "t_3", from: `${D}T19:00:00+02:00`, to: `${D}T21:00:00+02:00` }, hz.auth(mt, "rt-open"));
  if (pr.s !== 200 || J(pr.b) !== J(open.b)) e.push(`preview receipt after import ${pr.s}`);
  const np = await hz.replan({ table_id: "t_1", from: `${D}T09:00:00+02:00`, to: `${D}T10:00:00+02:00` });
  if (np.s !== 201 || [p.b.plan_id, open.b.plan_id].includes(np.b.plan_id)) e.push(`new plan id after import collides ${np.b?.plan_id}`);
  // integrity of imported plans and closures (INC-1..3 family)
  const base = J(ex);
  const tryImport = async (what, mut) => {
    const bad = JSON.parse(base); mut(bad.state);
    const r = await z.call("POST", "/_test/import", bad);
    if (r.s !== 422) e.push(`import ${what}: ${r.s}`);
    await z.call("POST", "/_test/import", JSON.parse(base));
  };
  const rest = (s) => s.restaurants.find((r) => r.id === "r_anker");
  await tryImport("closure on unknown table", (s) => { rest(s).closures[0].table_id = "t_9"; });
  await tryImport("closure from >= to", (s) => { const c = rest(s).closures[0]; c.to_ms = c.from_ms; c.to = c.from; });
  await tryImport("plan for unknown restaurant", (s) => { s.plans[0].restaurant_id = "r_nope"; });
  await tryImport("plan assignment names unknown booking", (s) => { s.plans[0].assignments[0].reference = "NOPE99"; });
  await tryImport("plan assignment undeclared pair", (s) => { s.plans[0].assignments[0].table_ids = ["t_1", "t_3"]; });
  await tryImport("duplicate plan id", (s) => { s.plans[1].plan_id = s.plans[0].plan_id; });
  await tryImport("restaurant revision negative", (s) => { rest(s).revision = -1; });
} catch (err) { e.push(`error ${err.stack?.split("\n").slice(0, 2).join(" ")}`); }
finally { for (const s of servers) s.stop(); }
console.log(e.length ? `FAIL S4 f10-import-stage4 | ${e.join("; ")} | "${quote}"` : `PASS S4 f10-import-stage4 | "${quote}"`);
process.exit(e.length ? 1 : 0);
