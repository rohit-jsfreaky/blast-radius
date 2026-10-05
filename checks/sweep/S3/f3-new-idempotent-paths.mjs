import { run, J, errs, policy } from "./lib.mjs";
// Stage-1 replay rules on the two new idempotent paths.
await run("f3-new-idempotent-paths", "`POST /restaurants/{id}/policies` requires an idempotency key, with stage 1's replay rules.", async (call, h) => {
  const e = errs();
  const mgr = await h.login("mgr");
  const P = (body, key, rid = "r_anker", tok = mgr) => call("POST", `/restaurants/${rid}/policies`, body, h.auth(tok, key));
  e.check((await call("POST", "/restaurants/r_anker/policies", policy(), h.auth(mgr))).s === 400, "policy without key not 400");
  e.check((await P(policy(), "x".repeat(256))).s === 422, "policy key 256 chars not 422");
  const bad = await P(policy({ slot_minutes: true }), "pk-fail");
  e.check(bad.s === 422, `boolean slot_minutes ${bad.s}`);
  const ok = await P(policy(), "pk-fail");
  e.check(ok.s === 201 && ok.b.policy_version === 1, `failed key reuse ${ok.s} v${ok.b?.policy_version}`);
  const rp = await P({ ...policy(), zzz: 1, effective_from: "2027-09-01" }, "pk-fail");
  e.check(rp.s === 409, `different body (extra field) same key ${rp.s} — unknown fields are part of the JSON body`);
  const rp2 = await P(JSON.parse(J(policy())), "pk-fail");
  e.check(rp2.s === 200 && J(rp2.b) === J(ok.b), `replay ${rp2.s}`);
  e.check((await P(policy({ slot_minutes: 0 }), "pk-fail")).s === 409, "different invalid body with used key not 409 (idempotency before validation)");
  const v2 = await P(policy(), "pk-2");
  e.check(v2.b?.policy_version === 2, "replays allocated a version");
  // series
  const a = await h.book({ table_id: "t_1", starts_at_local: "2027-09-23T19:00" });
  const tok = await h.login();
  const S = (body, key, t = tok) => call("POST", "/series", body, h.auth(t, key));
  e.check((await call("POST", "/series", { anchor_reference: a.b.reference, count: 2, interval_weeks: 1 }, h.auth(tok))).s === 400, "series without key not 400");
  const sb = { anchor_reference: a.b.reference, count: 2, interval_weeks: 1 };
  const s1 = await S(sb, "sk");
  e.check(s1.s === 201, `series ${s1.s} ${J(s1.b)}`);
  await h.patch(s1.b.occurrences[1].reference, { party_size: 1 });
  const s2 = await S(sb, "sk");
  e.check(s2.s === 200 && J(s2.b) === J(s1.b), "series replay after change is not the original");
  e.check((await S({ ...sb, count: 3 }, "sk")).s === 409, "series different body not 409");
  const s3 = await S(sb, "sk", await h.login("bob"));
  e.check(s3.s === 404, `same key other user must be an independent request (404 anchor not theirs), got ${s3.s}`);
  e.check((await call("POST", "/reservations", { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2027-09-23T19:00", party_size: 2 }, h.auth(tok, "sk"))).s === 201, "same key on different path not independent");
  // concurrency: same key, 10 parallel series requests -> exactly one 201
  const b = await h.book({ table_id: "t_3", starts_at_local: "2027-09-23T12:00" });
  const par = await Promise.all(Array.from({ length: 10 }, () => S({ anchor_reference: b.b.reference, count: 3, interval_weeks: 2 }, "par")));
  e.check(par.filter((r) => r.s === 201).length === 1 && par.filter((r) => r.s === 200).length === 9, `parallel series ${J(par.map((r) => r.s))}`);
  return e.result();
});
