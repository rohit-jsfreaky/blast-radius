// INC-1 sweep library (investigator). Family rule: data that enters through POST /_test/reset or
// POST /_test/import must satisfy the same invariants the API guarantees for data it creates.
// Written from the requirements text only. Usage: node <probe>.mjs <repo-or-stage-folder>
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

const fx = () => ({
  users: [{ id: "u_ada", email: "ada@example.com", password: "correct horse", display_name: "Ada" }],
  restaurants: [{ id: "r_anker", name: "Zum Anker", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90,
    cancellation_cutoff_minutes: 120, opening_hours: [{ weekday: "thu", opens: "18:00", closes: "23:00" }],
    tables: [{ id: "t_1", label: "1", capacity: 2 }, { id: "t_2", label: "2", capacity: 4 }] },
    { id: "r_b", name: "B", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90,
    cancellation_cutoff_minutes: 120, opening_hours: [{ weekday: "thu", opens: "18:00", closes: "23:00" }],
    tables: [{ id: "t_9", label: "9", capacity: 4 }] }],
  reservations: [{ id: "res_a", reference: "ABC123", user_id: "u_ada", restaurant_id: "r_anker", table_id: "t_2",
    starts_at_local: "2026-09-24T19:00", party_size: 2 }],
});
const seed2 = (patch) => { const f = fx(); f.reservations.push({ ...f.reservations[0], id: "res_b", reference: "XYZ789", ...patch }); return f; };

// Each check: [requirement quote, async (call) => true PASS / string FAIL reason]
const rejectsReset = (mk) => async (call) => {
  const r = await call("POST", "/_test/reset", mk());
  return r.s >= 400 && r.s < 500 ? true : `reset returned ${r.s}, want 4xx (fixture violates the invariant)`;
};
const rejectsImport = (mutate) => async (call) => {
  if ((await call("POST", "/_test/reset", fx())).s !== 204) return "baseline reset failed";
  const ex = (await call("GET", "/_test/export")).b;
  const before = JSON.stringify(ex);
  const bad = structuredClone(ex);
  mutate(bad.state);
  const r = await call("POST", "/_test/import", bad);
  if (r.s !== 422) return `import returned ${r.s}, want 422 validation_failed`;
  const after = JSON.stringify((await call("GET", "/_test/export")).b);
  return after === before ? true : "rejected import changed the destination";
};

export const CHECKS = {
  "seed-ref-format": ["`reference` is 6 to 12 characters of `A-Z0-9`", rejectsReset(() => { const f = fx(); f.reservations[0].reference = "bad"; return f; })],
  "seed-ref-duplicate": ["unique across all reservations", rejectsReset(() => seed2({ reference: "ABC123", starts_at_local: "2026-09-24T21:00" }))],
  "import-ref-format": ["`reference` is 6 to 12 characters of `A-Z0-9`", rejectsImport((s) => { s.reservations[0].reference = "bad"; })],
  "import-ref-duplicate": ["unique across all reservations", rejectsImport((s) => { s.reservations.push({ ...s.reservations[0], reservation_id: "res_z" }); })],
  "seed-overlap": ["Two `confirmed` reservations must never occupy the same table at overlapping times", rejectsReset(() => seed2({ starts_at_local: "2026-09-24T20:00" }))],
  "seed-table-foreign": ["the table belongs to another restaurant", rejectsReset(() => seed2({ table_id: "t_9", starts_at_local: "2026-09-24T21:00" }))],
  "seed-dup-restaurant": ["IDs are opaque strings", rejectsReset(() => { const f = fx(); f.restaurants[1].id = "r_anker"; return f; })],
  "seed-dup-user-id": ["IDs are opaque strings", rejectsReset(() => { const f = fx(); f.users.push({ id: "u_ada", email: "bob@example.com", password: "correct horse", display_name: "Bob" }); return f; })],
  "seed-unknown-user": ["`reservations` may seed confirmed bookings, with the same fields as a `POST /reservations` body plus `id`, `reference` and `user_id`.", rejectsReset(() => seed2({ user_id: "u_nobody", starts_at_local: "2026-09-24T21:00" }))],
};

export async function run(names) {
  const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
  const dir = [join(arg, "stage-1"), arg].find((d) => existsSync(join(d, "src", "server.ts")));
  if (!dir) { console.log(`FAIL INC-1 no stage-1/src/server.ts under ${arg}`); process.exit(1); }
  const port = await freePort();
  const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.ts"], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const B = `http://127.0.0.1:${port}`;
  const call = async (m, p, body) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
    return { s: r.status, b };
  };
  let fails = 0;
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(B + "/health")).status === 200) break; } catch {} if (i > 100) throw new Error("server not healthy"); await new Promise((r) => setTimeout(r, 100)); }
    for (const n of names) {
      const [quote, fn] = CHECKS[n];
      let res; try { res = await fn(call); } catch (e) { res = `error ${e.message}`; }
      if (res === true) console.log(`PASS INC-1 ${n} | "${quote}"`); else { fails++; console.log(`FAIL INC-1 ${n} | ${res} | "${quote}"`); }
    }
  } catch (e) { fails++; console.log(`FAIL INC-1 ${e.message}`); }
  finally { srv.kill(); }
  process.exit(fails ? 1 : 0);
}
