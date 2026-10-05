import { startServer, fx, J, policy, helpers } from "./lib.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
const quote = "A stage-3 service must accept exports produced by the same team's stage-1 or stage-2 service. Adoption must work on reservations imported this way.";
const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
const find = (st) => [join(arg, st), join(arg, "..", st), arg].find((d) => existsSync(join(d, "src", "server.ts")) && (d.endsWith(st) || st === "stage-3"));
const d3 = [join(arg, "stage-3"), arg].find((d) => existsSync(join(d, "src", "server.ts")));
const e = [];
const servers = [];
try {
  for (const st of ["stage-1", "stage-2"]) {
    const d = process.env[`${st.toUpperCase().replace("-", "")}_DIR`] || [join(arg, st), join(arg, "..", st)].find((x) => existsSync(join(x, "src", "server.ts")));
    const old = await startServer(d); servers.push(old);
    const f = fx(); for (const r of f.restaurants) { delete r.manager_user_ids; if (st === "stage-1") delete r.combinable; }
    if ((await old.call("POST", "/_test/reset", f)).s !== 204) throw new Error(`${st} reset`);
    const ho = helpers(old.call);
    const body = { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2027-09-23T19:00", party_size: 2 };
    const orig = await old.call("POST", "/reservations", body, ho.auth(await ho.login(), "up"));
    const tok = await ho.login();
    const ex = (await old.call("GET", "/_test/export")).b;
    const s3 = await startServer(d3); servers.push(s3);
    const im = await s3.call("POST", "/_test/import", ex);
    if (im.s !== 204) { e.push(`${st} import ${im.s} ${J(im.b)}`); continue; }
    const h3 = helpers(s3.call);
    const rp = await s3.call("POST", "/reservations", body, h3.auth(tok, "up"));
    if (rp.s !== 200 || J(rp.b) !== J(orig.b)) e.push(`${st}: replay after upgrade ${rp.s} ${J(rp.b)}`);
    const g = await s3.call("GET", `/reservations/${orig.b.reference}`, undefined, h3.auth(tok));
    if (g.s !== 200 || g.b.revision !== 1 || g.b.accepted_terms?.policy_version !== 0 || g.b.accepted_terms?.reservation_duration_minutes !== 90) e.push(`${st}: imported booking ${g.s} rev ${g.b?.revision} terms ${J(g.b?.accepted_terms)}`);
    const hs = await s3.call("GET", `/reservations/${orig.b.reference}/history`, undefined, h3.auth(tok));
    if (hs.s !== 200 || !Array.isArray(hs.b?.entries)) e.push(`${st}: history of imported booking ${hs.s}`);
    const se = await s3.call("POST", "/series", { anchor_reference: orig.b.reference, count: 3, interval_weeks: 1 }, h3.auth(tok, "ser"));
    if (se.s !== 201) e.push(`${st}: adoption on imported booking ${se.s} ${J(se.b)}`);
    const pub = await s3.call("POST", "/restaurants/r_anker/policies", policy(), h3.auth(await h3.login("mgr").catch(() => null), "pp"));
    if (pub.s !== 403) e.push(`${st}: imported restaurant should have no managers (403), got ${pub.s}`);
    const c = await s3.call("POST", `/reservations/${orig.b.reference}/cancel`, {}, h3.auth(tok));
    if (c.s !== 200 || c.b.revision !== 2) e.push(`${st}: cancel imported ${c.s} rev ${c.b?.revision}`);
  }
  // stage-3 -> stage-3 round trip keeps everything
  const a = await startServer(d3); servers.push(a);
  await a.call("POST", "/_test/reset", fx());
  const ha = helpers(a.call);
  const b = await ha.book({ table_ids: ["t_1", "t_2"], starts_at_local: "2027-09-23T19:00", party_size: 4 }, "ada", "rt-b");
  await ha.publish(policy({ effective_from: "2027-10-01", reservation_duration_minutes: 60 }), "r_anker", "mgr", "rt-p");
  const s = await ha.series({ anchor_reference: b.b.reference, count: 3, interval_weeks: 1 }, "ada", "rt-s");
  await ha.patch(s.b.occurrences[2].reference, { party_size: 3 });
  const ex = (await a.call("GET", "/_test/export")).b;
  const z = await startServer(d3); servers.push(z);
  if ((await z.call("POST", "/_test/import", ex)).s !== 204) e.push("stage-3 round trip import");
  const hz = helpers(z.call);
  const tok = await ha.login();
  const same = async (p) => J((await a.call("GET", p, undefined, ha.auth(tok))).b) === J((await z.call("GET", p, undefined, ha.auth(tok))).b);
  for (const p of [`/series/${s.b.series_id}`, `/reservations/${b.b.reference}/history`, `/reservations/${s.b.occurrences[2].reference}/history`, `/reservations/${s.b.occurrences[2].reference}/decision`, "/reservations", "/restaurants/r_anker/policies"])
    if (!(await same(p))) e.push(`round trip differs: ${p}`);
  const rs = await z.call("POST", "/series", { anchor_reference: b.b.reference, count: 3, interval_weeks: 1 }, ha.auth(tok, "rt-s"));
  if (rs.s !== 200 || J(rs.b) !== J(s.b)) e.push(`series receipt after import ${rs.s}`);
  const rpp = await z.call("POST", "/restaurants/r_anker/policies", policy({ effective_from: "2027-10-01", reservation_duration_minutes: 60 }), ha.auth(await hz.login("mgr"), "rt-p"));
  if (rpp.s !== 200) e.push(`policy receipt after import ${rpp.s}`);
  const nv = await z.call("POST", "/restaurants/r_anker/policies", policy(), ha.auth(await hz.login("mgr"), "rt-p2"));
  if (nv.b?.policy_version !== 2) e.push(`policy_version after import ${nv.b?.policy_version}`);
  const occ = s.b.occurrences[1].reference;
  const pz = await z.call("PATCH", `/reservations/${occ}`, { party_size: 3 }, ha.auth(tok));
  const gz = (await z.call("GET", `/series/${s.b.series_id}`, undefined, ha.auth(tok))).b;
  if (pz.s !== 200 || gz.revision !== 3 || gz.occurrences[2].exception !== true || gz.occurrences[1].exception !== true) e.push(`series counters after import: rev ${gz.revision} exc ${J(gz.occurrences.map((o) => o.exception))}`);
} catch (err) { e.push(`error ${err.message}`); }
finally { for (const s of servers) s.stop(); }
console.log(e.length ? `FAIL S3 f10-upgrade-and-roundtrip | ${e.join("; ")} | "${quote}"` : `PASS S3 f10-upgrade-and-roundtrip | "${quote}"`);
process.exit(e.length ? 1 : 0);
