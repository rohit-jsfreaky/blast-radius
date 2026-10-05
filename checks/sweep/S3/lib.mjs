// Stage-3 family sweep (investigator). Probes written from spec/stage-3.md (+ stages 1-2) only.
// Usage: node <probe>.mjs <repo-root | stage folder>   (default stage folder: stage-3)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
export const J = JSON.stringify;

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

const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const hours = (opens = "10:00", closes = "23:00") => ALL.map((weekday) => ({ weekday, opens, closes }));
export const fx = (extra = {}) => ({
  users: ["ada", "bob", "mgr"].map((n) => ({ id: `u_${n}`, email: `${n}@example.com`, password: "correct horse", display_name: n })),
  restaurants: [{ id: "r_anker", name: "Zum Anker", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90,
    cancellation_cutoff_minutes: 120, opening_hours: hours("00:00", "23:00"),
    tables: [{ id: "t_1", label: "Window", capacity: 2 }, { id: "t_2", label: "Booth", capacity: 4 }, { id: "t_3", label: "Garden", capacity: 4 }],
    combinable: [["t_1", "t_2"], ["t_2", "t_3"]], manager_user_ids: ["u_mgr"] },
    { id: "r_ny", name: "Diner", timezone: "America/New_York", slot_minutes: 30, reservation_duration_minutes: 60,
    cancellation_cutoff_minutes: 0, opening_hours: hours("00:00", "23:30"), tables: [{ id: "n_1", label: "1", capacity: 4 }], combinable: [], manager_user_ids: ["u_mgr"] }],
  reservations: [],
  ...extra,
});
/** A complete policy for r_anker. */
export const policy = (p = {}) => ({ effective_from: "2027-09-01", slot_minutes: 30, reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
  opening_hours: hours("00:00", "23:00"), capacities: { t_1: 2, t_2: 4, t_3: 4 }, ...p });

let n = 0;
export const helpers = (call) => {
  const tokens = {};
  const login = async (who = "ada") => tokens[who] ??= (await call("POST", "/auth/login", { email: `${who}@example.com`, password: "correct horse" })).b.token;
  const auth = (tok, key) => ({ ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(key ? { "idempotency-key": key } : {}) });
  const key = () => `k${++n}-${Date.now()}`;
  const book = async (body, who = "ada", k = key()) => call("POST", "/reservations", { restaurant_id: "r_anker", party_size: 2, ...body }, auth(await login(who), k));
  const patch = async (ref, body, who = "ada") => call("PATCH", `/reservations/${ref}`, body, auth(await login(who)));
  const cancel = async (ref, who = "ada") => call("POST", `/reservations/${ref}/cancel`, {}, auth(await login(who)));
  const get = async (ref, who = "ada") => call("GET", `/reservations/${ref}`, undefined, auth(await login(who)));
  const hist = async (ref, who = "ada") => call("GET", `/reservations/${ref}/history`, undefined, auth(await login(who)));
  const publish = async (body, rid = "r_anker", who = "mgr", k = key()) => call("POST", `/restaurants/${rid}/policies`, body, auth(await login(who), k));
  const moves = async (mv, who = "ada", k = key()) => call("POST", "/reservation-moves", { moves: mv }, auth(await login(who), k));
  const series = async (body, who = "ada", k = key()) => call("POST", "/series", body, auth(await login(who), k));
  const avail = async (date, ps = 2, rid = "r_anker", extra = "") => (await call("GET", `/availability?restaurant_id=${rid}&date=${date}&party_size=${ps}${extra}`)).b;
  /** Restaurant revision counter, read from the export state (stage-4 readiness; implementation-defined location). */
  const rrev = async (rid = "r_anker") => (await call("GET", "/_test/export")).b.state.restaurants.find((r) => r.id === rid).revision;
  return { login, auth, key, book, patch, cancel, get, hist, publish, moves, series, avail, rrev };
};

/** Local date (YYYY-MM-DD) `days` from now in Europe/Berlin. */
export const berlinDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + days * 86400000));

export async function run(name, quote, fn) {
  const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
  const dir = [join(arg, "stage-3"), arg].find((d) => existsSync(join(d, "src", "server.ts")));
  if (!dir) { console.log(`FAIL S3 ${name} no stage-3/src/server.ts under ${arg}`); process.exit(1); }
  let srv; let res;
  try { srv = await startServer(dir); const r0 = await srv.call("POST", "/_test/reset", fx()); if (r0.s !== 204) throw new Error(`baseline reset ${r0.s} ${J(r0.b)}`); res = await fn(srv.call, helpers(srv.call), { arg, dir }); }
  catch (e) { res = `error ${e.message}`; }
  finally { srv?.stop(); }
  if (res === true) { console.log(`PASS S3 ${name} | "${quote}"`); process.exit(0); }
  console.log(`FAIL S3 ${name} | ${res} | "${quote}"`); process.exit(1);
}
export const errs = () => { const e = []; e.check = (ok, msg) => { if (!ok) e.push(msg); }; e.result = () => (e.length ? e.join("; ") : true); return e; };
