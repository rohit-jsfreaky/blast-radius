// Stage-4 family sweep (investigator). Probes written from spec/stage-4.md (+ stages 1-3) only.
// Usage: node <probe>.mjs <repo-root | stage folder>   (default stage folder: stage-4)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer, fx, helpers, policy, hours, J, errs, berlinDate } from "../S3/lib.mjs";
export { startServer, fx, helpers, policy, hours, J, errs, berlinDate };

export const stageDir = () => {
  const arg = process.argv[2] || process.env.BLAST_TARGET_DIR || ".";
  return [join(arg, "stage-4"), arg].find((d) => existsSync(join(d, "src", "server.ts")));
};

/** Stage-4 helpers on top of stage-3 ones. */
export const h4 = (call) => {
  const h = helpers(call);
  const replan = async (body, rid = "r_anker", who = "mgr", k = h.key()) => call("POST", `/restaurants/${rid}/replans`, body, h.auth(await h.login(who), k));
  const apply = async (planId, rid = "r_anker", who = "mgr", k = h.key()) => call("POST", `/restaurants/${rid}/replans/${planId}/apply`, {}, h.auth(await h.login(who), k));
  const amend = async (sid, body, who = "ada", k = h.key()) => call("POST", `/series/${sid}/amend`, body, h.auth(await h.login(who), k));
  const getSeries = async (sid, who = "ada") => call("GET", `/series/${sid}`, undefined, h.auth(await h.login(who)));
  return { ...h, replan, apply, amend, getSeries };
};

export async function run(name, quote, fn) {
  const dir = stageDir();
  if (!dir) { console.log(`FAIL S4 ${name} no stage-4/src/server.ts`); process.exit(1); }
  let srv; let res;
  try { srv = await startServer(dir); const r0 = await srv.call("POST", "/_test/reset", fx()); if (r0.s !== 204) throw new Error(`baseline reset ${r0.s} ${J(r0.b)}`); res = await fn(srv.call, h4(srv.call), { dir }); }
  catch (e) { res = `error ${e.stack?.split("\n").slice(0, 2).join(" ") || e.message}`; }
  finally { srv?.stop(); }
  if (res === true) { console.log(`PASS S4 ${name} | "${quote}"`); process.exit(0); }
  console.log(`FAIL S4 ${name} | ${res} | "${quote}"`); process.exit(1);
}
