// Stage-2 family sweep (investigator). Probes written from spec/stage-2.md and stage-1.md only.
// Usage: node <probe>.mjs <repo-root | stage folder>   (default stage folder: stage-2)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

export async function startServer(dir) {
  const port = await freePort();
  const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.ts"], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const B = `http://127.0.0.1:${port}`;
  const call = async (m, p, body, h = {}) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
    return { s: r.status, b };
  };
  for (let i = 0; ; i++) { try { if ((await fetch(B + "/health")).status === 200) break; } catch {} if (i > 150) throw new Error("server not healthy"); await new Promise((r) => setTimeout(r, 100)); }
  return { call, B, stop: () => srv.kill() };
}

export const fx = (extra = {}) => ({
  users: [{ id: "u_ada", email: "ada@example.com", password: "correct horse", display_name: "Ada" },
          { id: "u_bob", email: "bob@example.com", password: "correct horse", display_name: "Bob" }],
  restaurants: [{ id: "r_anker", name: "Zum Anker", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90,
    cancellation_cutoff_minutes: 120, opening_hours: [{ weekday: "thu", opens: "18:00", closes: "23:00" }],
    tables: [{ id: "t_1", label: "Window", capacity: 2 }, { id: "t_2", label: "Booth", capacity: 4 }, { id: "t_3", label: "Garden", capacity: 4 }],
    combinable: [["t_1", "t_2"], ["t_2", "t_3"]] }],
  reservations: [],
  ...extra,
});

let n = 0;
export const helpers = (call) => {
  const login = async (email = "ada@example.com") => (await call("POST", "/auth/login", { email, password: "correct horse" })).b.token;
  const auth = (tok, key) => ({ authorization: `Bearer ${tok}`, ...(key ? { "idempotency-key": key } : {}) });
  const book = (tok, body, key = `k${++n}-${Date.now()}`) => call("POST", "/reservations", body, auth(tok, key));
  const slot = async (date = "2027-09-23", ps = 1) => (await call("GET", `/availability?restaurant_id=r_anker&date=${date}&party_size=${ps}`)).b.slots;
  return { login, auth, book, slot };
};

export async function run(name, quote, fn) {
  const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
  const dir = [join(arg, "stage-2"), arg].find((d) => existsSync(join(d, "src", "server.ts")));
  if (!dir) { console.log(`FAIL S2 ${name} no stage-2/src/server.ts under ${arg}`); process.exit(1); }
  let srv; let res;
  try { srv = await startServer(dir); if ((await srv.call("POST", "/_test/reset", fx())).s !== 204) throw new Error("baseline reset failed"); res = await fn(srv.call, helpers(srv.call), { arg, dir }); }
  catch (e) { res = `error ${e.message}`; }
  finally { srv?.stop(); }
  if (res === true) { console.log(`PASS S2 ${name} | "${quote}"`); process.exit(0); }
  console.log(`FAIL S2 ${name} | ${res} | "${quote}"`); process.exit(1);
}
export const J = JSON.stringify;
