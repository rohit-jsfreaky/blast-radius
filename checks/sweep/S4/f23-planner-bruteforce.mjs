import { run, J, hours } from "./lib.mjs";
// Independent exhaustive reference for the replan objective, written from the requirement text only:
//  considered = every confirmed booking at the restaurant overlapping [from,to) (any table);
//  candidates = singles in fixture order then declared pairs in declared order (rank = index);
//  capacity under the booking's OWN accepted_terms.capacities; no conflict with fixed bookings,
//  other assignments, previously applied closures or the proposed closure;
//  minimise (moved count, unused seats, rank vector in ascending reference order).
const CASES = Number(process.env.CASES || 60);
let seed = Number(process.env.SEED || 20261005);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const DATE = "2027-09-23";
const ms = (iso) => Date.parse(iso);
const ov = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

function reference(tables, pairs, all, closures, closure) {
  const opts = [...tables.map((t) => [t]), ...pairs];
  const cons = all.filter((b) => b.status === "confirmed" && ov(b.s, b.e, closure.f, closure.t)).sort((x, y) => (x.ref < y.ref ? -1 : 1));
  const fixed = all.filter((b) => b.status === "confirmed" && !cons.includes(b));
  if (cons.length > 6) return { limit: true };
  const blocks = [...closures, closure];
  const cand = cons.map((b) => opts.map((o, rank) => ({ o, rank })).filter(({ o }) => {
    const cap = o.reduce((s, t) => s + (b.caps[t] ?? -1e9), 0);
    if (cap < b.party) return false;
    if (blocks.some((c) => o.includes(c.table) && ov(b.s, b.e, c.f, c.t))) return false;
    if (fixed.some((x) => x.tables.some((t) => o.includes(t)) && ov(b.s, b.e, x.s, x.e))) return false;
    return true;
  }).map(({ o, rank }) => ({ o, rank, cap: o.reduce((s, t) => s + b.caps[t], 0) })));
  let best = null; const pick = [];
  const key = (p) => [p.reduce((s, c, i) => s + (J([...c.o].sort()) !== J([...cons[i].tables].sort()) ? 1 : 0), 0), p.reduce((s, c, i) => s + c.cap - cons[i].party, 0), ...p.map((c) => c.rank)];
  const less = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  const rec = (i) => {
    if (i === cons.length) { const k = key(pick); if (!best || less(k, best.k)) best = { k, p: [...pick] }; return; }
    for (const c of cand[i]) {
      if (pick.some((q, j) => q.o.some((t) => c.o.includes(t)) && ov(cons[i].s, cons[i].e, cons[j].s, cons[j].e))) continue;
      pick.push(c); rec(i + 1); pick.pop();
    }
  };
  rec(0);
  if (!best) return { infeasible: true, cons };
  return { cons, assignments: cons.map((b, i) => ({ reference: b.ref, table_ids: best.p[i].o, changed: J([...best.p[i].o].sort()) !== J([...b.tables].sort()) })), moved: best.k[0], unused: best.k[1] };
}

await run("f23-planner-bruteforce", "Among feasible plans minimize, in order:", async (call, h) => {
  const fails = []; let compared = 0, infeasible = 0, applied = 0, limits = 0;
  for (let c = 0; c < CASES && fails.length < 5; c++) {
    const nt = ri(2, 6);
    const tables = Array.from({ length: nt }, (_, i) => ({ id: `t${i}`, label: `T${i}`, capacity: ri(1, 6) }));
    const allPairs = []; for (let i = 0; i < nt; i++) for (let j = i + 1; j < nt; j++) allPairs.push(rnd() < 0.5 ? [`t${i}`, `t${j}`] : [`t${j}`, `t${i}`]);
    const pairs = allPairs.sort(() => rnd() - 0.5).slice(0, ri(0, Math.min(4, allPairs.length)));
    const f = { users: ["ada", "mgr"].map((n) => ({ id: `u_${n}`, email: `${n}@example.com`, password: "correct horse", display_name: n })),
      restaurants: [{ id: "r_anker", name: "A", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 0,
        opening_hours: hours("17:00", "23:00"), tables, combinable: pairs, manager_user_ids: ["u_mgr"] }], reservations: [] };
    const r0 = await call("POST", "/_test/reset", f); if (r0.s !== 204) { fails.push(`case ${c}: reset ${r0.s} ${J(r0.b)}`); continue; }
    const H = (await import("./lib.mjs")).h4(call);
    // bookings, part of them under a second policy with different capacities (per-booking accepted terms)
    const tryBook = async () => { const o = rnd() < 0.7 || !pairs.length ? [tables[ri(0, nt - 1)].id] : pairs[ri(0, pairs.length - 1)];
      return H.book({ table_ids: o, starts_at_local: `${DATE}T${String(ri(17, 21)).padStart(2, "0")}:${rnd() < 0.5 ? "00" : "30"}`, party_size: ri(1, 4) }); };
    for (let i = 0, n = ri(2, 5); i < n; i++) await tryBook();
    if (rnd() < 0.5) {
      const caps = Object.fromEntries(tables.map((t) => [t.id, ri(1, 6)]));
      await H.publish({ effective_from: "2027-09-01", slot_minutes: 30, reservation_duration_minutes: [60, 90][ri(0, 1)], cancellation_cutoff_minutes: 0, opening_hours: hours("17:00", "23:00"), capacities: caps });
      for (let i = 0, n = ri(1, 3); i < n; i++) await tryBook();
    }
    if (rnd() < 0.3) { const l = (await call("GET", "/reservations", undefined, H.auth(await H.login()))).b.reservations; if (l.length) await H.cancel(l[0].reference); }
    const closures = [];
    for (let round = 0; round < 2; round++) {
      const list = (await call("GET", "/reservations", undefined, H.auth(await H.login()))).b.reservations;
      const all = list.map((b) => ({ ref: b.reference, status: b.status, party: b.party_size, s: ms(b.starts_at), e: ms(b.ends_at), tables: b.table_ids, caps: b.accepted_terms.capacities }));
      const occupied = all.filter((b) => b.status === "confirmed").flatMap((b) => b.tables);
      const table = rnd() < 0.8 && occupied.length ? occupied[ri(0, occupied.length - 1)] : tables[ri(0, nt - 1)].id;
      const fh = ri(17, 21), th = ri(fh + 1, 23);
      const closure = { table, from: `${DATE}T${String(fh).padStart(2, "0")}:${rnd() < 0.5 ? "00" : "30"}:00+02:00`, to: `${DATE}T${th}:00:00+02:00` };
      const cl = { table, f: ms(closure.from), t: ms(closure.to) };
      const ref = reference(tables.map((t) => t.id), pairs, all, closures, cl);
      const p = await H.replan({ table_id: table, from: closure.from, to: closure.to });
      const tag = `case ${c}.${round} seed ${process.env.SEED || 20261005} closure ${J(closure)}`;
      if (ref.limit) { limits++; if (p.s !== 201 && !(p.s === 422 && p.b?.error?.code === "planning_limit")) fails.push(`${tag}: >6 considered, got ${p.s}`); break; }
      if (ref.infeasible) {
        infeasible++;
        if (p.s !== 409 || p.b?.error?.code !== "no_feasible_plan") fails.push(`${tag}: reference infeasible, service ${p.s} ${J(p.b).slice(0, 300)}`);
        break;
      }
      compared++;
      if (p.s !== 201) { fails.push(`${tag}: reference ${J(ref.assignments)}, service ${p.s} ${J(p.b)}`); break; }
      const norm = (a) => a.map((x) => ({ reference: x.reference, table_ids: [...x.table_ids].sort(), changed: x.changed }));
      if (J(norm(p.b.assignments)) !== J(norm(ref.assignments)) || p.b.moved_count !== ref.moved || p.b.unused_seats !== ref.unused)
        fails.push(`${tag}: tables ${J(tables)} pairs ${J(pairs)} bookings ${J(all.map((b) => [b.ref, b.status, b.party, b.tables, new Date(b.s).toISOString().slice(11, 16), new Date(b.e).toISOString().slice(11, 16), b.caps]))} | want ${J(ref.assignments)} moved ${ref.moved} unused ${ref.unused} | got ${J(p.b.assignments)} moved ${p.b.moved_count} unused ${p.b.unused_seats}`);
      // pair order inside an assignment follows the declared combination
      for (const a of p.b.assignments) if (a.table_ids.length === 2 && !pairs.some((q) => J(q) === J(a.table_ids))) fails.push(`${tag}: pair ${J(a.table_ids)} not in declared order`);
      if (rnd() < 0.6) { const ap = await H.apply(p.b.plan_id); if (ap.s !== 201) { fails.push(`${tag}: apply ${ap.s} ${J(ap.b)}`); break; } applied++; closures.push(cl); }
      else break;
    }
  }
  console.log(`  compared ${compared} plans, ${infeasible} infeasible, ${applied} applied (later previews saw prior closures), ${limits} over limit`);
  return fails.length ? fails.join(" || ") : true;
});
