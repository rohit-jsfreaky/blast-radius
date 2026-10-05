// builder-a smoke check of WI4.1-4.2 (replans). Compares the service with an independent brute-force optimum on random cases.
const B = `http://localhost:${process.env.PORT || 18086}`;
const call = async (m, p, body, h = {}) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); return { s: r.status, b: t ? JSON.parse(t) : null };
};
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log("FAIL", name, JSON.stringify(got), "want", JSON.stringify(want)); } else console.log("ok  ", name); };
const DAY = "2027-06-";           // all Thursdays/anything: opening hours are every day
const hours = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((weekday) => ({ weekday, opens: "10:00", closes: "23:00" }));
const baseUsers = [{ id: "u_ada", email: "ada@example.com", password: "correct horse", display_name: "Ada" }, { id: "u_mgr", email: "mgr@example.com", password: "correct horse", display_name: "Mgr" }];
const auth = (t, k) => ({ Authorization: `Bearer ${t}`, ...(k ? { "Idempotency-Key": k } : {}) });
const login = async (e) => (await call("POST", "/auth/login", { email: e, password: "correct horse" })).b.token;
const mkRest = (tables, combinable) => ({ id: "r1", name: "R", timezone: "UTC", slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120, manager_user_ids: ["u_mgr"], combinable, opening_hours: hours, tables });
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

// ---- independent brute force: enumerate every assignment, pick min by (moved, unused, ranks)
function brute(tables, combinable, bookings, closed, from, to) {
  const opts = tables.map((t) => [t.id]).concat(combinable.map((p) => [...p]));
  const cap = (b, ids) => ids.reduce((n, id) => n + (b.caps[id] ?? 0), 0);
  const cons = bookings.filter((b) => b.start < to && from < b.end).sort((a, b) => (a.ref < b.ref ? -1 : 1));
  const fixed = bookings.filter((b) => !cons.includes(b));
  const ov = (a, b) => a.start < b.end && b.start < a.end;
  let best = null;
  const rec = (i, pick) => {
    if (i === cons.length) {
      let moved = 0, unused = 0; const ranks = [];
      pick.forEach((k, j) => { const ids = opts[k]; const cur = cons[j].tables; if (!(ids.length === cur.length && ids.every((x) => cur.includes(x)))) moved++; unused += cap(cons[j], ids) - cons[j].party; ranks.push(k); });
      const key = [moved, unused, ...ranks];
      if (!best || key.some((v, idx) => (v !== best.key[idx]) && (v < best.key[idx]) && key.slice(0, idx).every((w, q) => w === best.key[q]))) best = { key, pick: [...pick], moved, unused };
      return;
    }
    for (let k = 0; k < opts.length; k++) {
      const ids = opts[k], b = cons[i];
      if (ids.includes(closed) || cap(b, ids) < b.party) continue;
      if (fixed.some((f) => ov(f, b) && f.tables.some((t) => ids.includes(t)))) continue;
      if (pick.some((pk, j) => ov(cons[j], b) && opts[pk].some((t) => ids.includes(t)))) continue;
      rec(i + 1, [...pick, k]);
    }
  };
  rec(0, []);
  return best ? { moved: best.moved, unused: best.unused, assign: cons.map((c, j) => [c.ref, opts[best.pick[j]]]) } : null;
}

// ---- random cases
let cases = 0, agree = 0;
for (let round = 0; round < (Number(process.env.ROUNDS) || 25); round++) {
  const nT = 3 + rnd(4);                                  // 3..6 tables
  const tables = Array.from({ length: nT }, (_, i) => ({ id: `t${i + 1}`, label: `${i + 1}`, capacity: 2 + rnd(5) }));
  const combinable = [];
  while (combinable.length < Math.min(2 + rnd(3), 4)) { const a = rnd(nT), b = rnd(nT); if (a !== b) { const p = [`t${Math.min(a, b) + 1}`, `t${Math.max(a, b) + 1}`]; if (!combinable.some((q) => q[0] === p[0] && q[1] === p[1])) combinable.push(p); } }
  const nB = 1 + rnd(5);
  const bookings = [];
  const fx = { users: baseUsers, restaurants: [mkRest(tables, combinable)], reservations: [] };
  const caps = Object.fromEntries(tables.map((t) => [t.id, t.capacity]));
  for (let i = 0; i < nB; i++) {
    const start = 11 * 60 + 30 * rnd(8);                  // 11:00..14:30
    const k = rnd(tables.length + combinable.length);
    const ids = k < tables.length ? [tables[k].id] : combinable[k - tables.length];
    const cap = ids.reduce((n, id) => n + caps[id], 0);
    const party = 1 + rnd(cap);
    const ref = `BK${String(round).padStart(2, "0")}${String.fromCharCode(65 + i)}${i}X`;
    // avoid seeding conflicts
    const s0 = Date.UTC(2027, 5, 10, 0, start), e0 = s0 + 3600_000;
    if (bookings.some((b) => b.start < e0 && s0 < b.end && b.tables.some((t) => ids.includes(t)))) continue;
    bookings.push({ ref, tables: ids, party, start: s0, end: e0, caps });
    const hh = String(Math.floor(start / 60)).padStart(2, "0"), mm = String(start % 60).padStart(2, "0");
    fx.reservations.push({ id: `res${i}`, reference: ref, user_id: "u_ada", restaurant_id: "r1", table_ids: ids, party_size: party, starts_at_local: `2027-06-10T${hh}:${mm}` });
  }
  if ((await call("POST", "/_test/reset", fx)).s !== 204) { console.log("seed rejected", JSON.stringify(fx).slice(0, 200)); fails++; continue; }
  const mgr = await login("mgr@example.com");
  const closed = tables[rnd(nT)].id;
  const from = Date.UTC(2027, 5, 10, 11, 0) + 30 * 60_000 * rnd(6), to = from + 3600_000 * (1 + rnd(3));
  const want = brute(tables, combinable, bookings, closed, from, to);
  const got = await call("POST", "/restaurants/r1/replans", { table_id: closed, from: new Date(from).toISOString().replace(".000Z", "Z"), to: new Date(to).toISOString().replace(".000Z", "Z") }, auth(mgr, `k${round}`));
  cases++;
  if (!want) { if (got.s === 409 && got.b.error.code === "no_feasible_plan") agree++; else { fails++; console.log("FAIL round", round, "expected no_feasible_plan got", got.s, JSON.stringify(got.b).slice(0, 150)); } continue; }
  const gotAssign = got.s === 201 ? got.b.assignments.map((a) => [a.reference, a.table_ids]) : null;
  const same = got.s === 201 && got.b.moved_count === want.moved && got.b.unused_seats === want.unused && JSON.stringify(gotAssign) === JSON.stringify(want.assign);
  if (same) agree++; else { fails++; console.log("FAIL round", round, JSON.stringify(got.b).slice(0, 300), JSON.stringify(want)); }
}
console.log(`random optimum agreement ${agree}/${cases}`);

// ---- fixed scenario: preview stores nothing, apply semantics
const tables = [{ id: "t1", label: "1", capacity: 2 }, { id: "t2", label: "2", capacity: 4 }, { id: "t3", label: "3", capacity: 4 }];
const fx2 = { users: baseUsers, restaurants: [mkRest(tables, [["t1", "t2"]])], reservations: [
  { id: "a", reference: "AAAAAA", user_id: "u_ada", restaurant_id: "r1", table_id: "t2", party_size: 3, starts_at_local: "2027-06-10T18:00" },
  { id: "b", reference: "BBBBBB", user_id: "u_ada", restaurant_id: "r1", table_id: "t1", party_size: 2, starts_at_local: "2027-06-10T18:30" }] };
await call("POST", "/_test/reset", fx2);
const mgr = await login("mgr@example.com"), ada = await login("ada@example.com");
const body = { table_id: "t2", from: "2027-06-10T18:00:00+00:00", to: "2027-06-10T23:00:00Z" };
eq("plan 401", (await call("POST", "/restaurants/r1/replans", body, { "Idempotency-Key": "x" })).s, 401);
eq("plan 403", (await call("POST", "/restaurants/r1/replans", body, auth(ada, "x"))).s, 403);
eq("plan 404 table", (await call("POST", "/restaurants/r1/replans", { ...body, table_id: "zz" }, auth(mgr, "x"))).s, 404);
for (const [n, o] of [["from>=to", { from: body.to, to: body.from }], ["no offset", { from: "2027-06-10T18:00:00" }], ["garbage", { to: "tomorrow" }], ["missing", { to: undefined }]])
  eq("plan 422 " + n, (await call("POST", "/restaurants/r1/replans", { ...body, ...o }, auth(mgr, "y-" + n))).s, 422);
const rev0 = (await call("GET", "/reservations/AAAAAA", undefined, auth(ada))).b.revision;
const pv = await call("POST", "/restaurants/r1/replans", body, auth(mgr, "pk"));
eq("preview 201", [pv.s, pv.b.restaurant_revision, pv.b.moved_count, pv.b.assignments.map((a) => [a.reference, a.table_ids, a.changed])], [201, 0, 1, [["AAAAAA", ["t3"], true], ["BBBBBB", ["t1"], false]]]);
eq("preview replay 200", (await call("POST", "/restaurants/r1/replans", body, auth(mgr, "pk"))).s, 200);
eq("preview changes nothing", [(await call("GET", "/reservations/AAAAAA", undefined, auth(ada))).b.revision, (await call("GET", "/reservations/AAAAAA/history", undefined, auth(ada))).b.entries.length], [rev0, 1]);
const apply = (id, k, t = mgr) => call("POST", `/restaurants/r1/replans/${id}/apply`, {}, auth(t, k));
eq("apply 403", (await apply(pv.b.plan_id, "a0", ada)).s, 403);
eq("apply 404 unknown", (await apply("plan_999", "a0")).s, 404);
const ap = await apply(pv.b.plan_id, "a1");
eq("apply 201", [ap.s, ap.b.restaurant_revision, ap.b.reservations.map((r) => [r.reference, r.table_ids, r.revision])], [201, 1, [["AAAAAA", ["t3"], 2], ["BBBBBB", ["t1"], 1]]]);
eq("apply replay 200 same", JSON.stringify((await apply(pv.b.plan_id, "a1")).b), JSON.stringify(ap.b));
eq("apply again other key", (await apply(pv.b.plan_id, "a2")).b.error.code, "plan_already_applied");
const h = (await call("GET", "/reservations/AAAAAA/history", undefined, auth(ada))).b.entries;
eq("history reassigned", [h.length, h[1].event, h[1].changes, h[1].plan_id, h[1].revision], [2, "reassigned", [{ field: "table_ids", from: ["t2"], to: ["t3"] }], pv.b.plan_id, 2]);
eq("unmoved gains nothing", (await call("GET", "/reservations/BBBBBB/history", undefined, auth(ada))).b.entries.length, 1);
const av = (await call("GET", "/availability?restaurant_id=r1&date=2027-06-10&party_size=1&explain=true")).b;
const s1830 = av.slots.find((s) => s.starts_at_local.endsWith("T18:30"));
eq("closed table excluded", [s1830.available_table_ids.includes("t2"), s1830.available_options.some((o) => o.table_ids.includes("t2")), s1830.explain.find((e) => e.table_id === "t2").rules[1].holds], [false, false, false]);
const mk = await call("POST", "/reservations", { restaurant_id: "r1", table_id: "t2", starts_at_local: "2027-06-10T20:00", party_size: 2 }, auth(ada, "mk"));
eq("create on closed table 409", [mk.s, mk.b.error.code], [409, "table_unavailable"]);
const pv2 = await call("POST", "/restaurants/r1/replans", { table_id: "t3", from: "2027-06-10T18:00:00Z", to: "2027-06-10T19:00:00Z" }, auth(mgr, "pk2"));
eq("second plan respects the applied closure", [pv2.s, pv2.b.error && pv2.b.error.code], [409, "no_feasible_plan"]);
// stale: plan made, then something else changes the restaurant, then apply
await call("POST", "/_test/reset", fx2);
const mgr3 = await login("mgr@example.com"), ada3 = await login("ada@example.com");
const p3 = await call("POST", "/restaurants/r1/replans", body, auth(mgr3, "q1"));
await call("POST", "/reservations", { restaurant_id: "r1", table_id: "t3", starts_at_local: "2027-06-12T12:00", party_size: 2 }, auth(ada3, "other"));
eq("stale plan", (await apply(p3.b.plan_id, "q2", mgr3)).b.error.code, "stale_plan");
// export/import keeps plans & closures
await call("POST", "/_test/reset", fx2);
const m4 = await login("mgr@example.com"), a4 = await login("ada@example.com");
const p4 = await call("POST", "/restaurants/r1/replans", body, auth(m4, "z1"));
await apply(p4.b.plan_id, "z2", m4);
const ex = (await call("GET", "/_test/export")).b;
eq("export has closure & plan", [ex.state.restaurants[0].closures.length, ex.state.plans.length], [1, 1]);
eq("import 204", (await call("POST", "/_test/import", ex)).s, 204);
eq("closure survives import", (await call("POST", "/reservations", { restaurant_id: "r1", table_id: "t2", starts_at_local: "2027-06-10T20:00", party_size: 2 }, auth(a4, "mk2"))).s, 409);
eq("apply replay survives import", (await apply(p4.b.plan_id, "z2", m4)).s, 200);
const bad = structuredClone(ex); bad.state.restaurants[0].closures[0].plan_id = "nope";
eq("import with orphan closure 422", (await call("POST", "/_test/import", bad)).s, 422);
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
