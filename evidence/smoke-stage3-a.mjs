// builder-a smoke check of WI3.1-3.4 (policies, explain, series, export/import). Own script, not the shipped tests.
const B = `http://localhost:${process.env.PORT || 18086}`;
const call = async (m, p, body, h = {}) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const t = await r.text(); return { s: r.status, b: t ? JSON.parse(t) : null };
};
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log("FAIL", name, JSON.stringify(got), "want", JSON.stringify(want)); } else console.log("ok  ", name); };
const FAR = "2027-03-";
const fx = {
  users: [
    { id: "u_ada", email: "ada@example.com", password: "correct horse", display_name: "Ada" },
    { id: "u_mgr", email: "mgr@example.com", password: "correct horse", display_name: "Mgr" },
    { id: "u_bob", email: "bob@example.com", password: "correct horse", display_name: "Bob" },
  ],
  restaurants: [{
    id: "r_anker", name: "Zum Anker", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
    manager_user_ids: ["u_mgr"], combinable: [["t_1", "t_2"]],
    opening_hours: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((weekday) => ({ weekday, opens: "18:00", closes: "23:00" })),
    tables: [{ id: "t_1", label: "1", capacity: 2 }, { id: "t_2", label: "2", capacity: 4 }, { id: "t_3", label: "3", capacity: 6 }],
  }],
  reservations: [],
};
const login = async (email) => (await call("POST", "/auth/login", { email, password: "correct horse" })).b.token;
const auth = (t, k) => ({ Authorization: `Bearer ${t}`, ...(k ? { "Idempotency-Key": k } : {}) });
await call("POST", "/_test/reset", fx);
const ada = await login("ada@example.com"), mgr = await login("mgr@example.com"), bob = await login("bob@example.com");

// ---- policies
const pol = (over = {}) => ({ effective_from: "2027-03-10", slot_minutes: 30, reservation_duration_minutes: 120, cancellation_cutoff_minutes: 60,
  opening_hours: [{ weekday: "mon", opens: "18:00", closes: "23:00" }, { weekday: "wed", opens: "18:00", closes: "23:00" }], capacities: { t_1: 2, t_2: 4, t_3: 8 }, ...over });
eq("policy 401", (await call("POST", "/restaurants/r_anker/policies", pol(), { "Idempotency-Key": "p1" })).s, 401);
eq("policy 403", (await call("POST", "/restaurants/r_anker/policies", pol(), auth(ada, "p1"))).s, 403);
eq("policy 404", (await call("POST", "/restaurants/nope/policies", pol(), auth(mgr, "p1"))).s, 404);
eq("policy no key", (await call("POST", "/restaurants/r_anker/policies", pol(), auth(mgr))).b.error.code, "missing_idempotency_key");
for (const [n, over] of [["bad date", { effective_from: "2027-02-30" }], ["bool slot", { slot_minutes: true }], ["dur 0", { reservation_duration_minutes: 0 }], ["cutoff big", { cancellation_cutoff_minutes: 10081 }],
  ["extra table", { capacities: { t_1: 2, t_2: 4, t_3: 8, t_4: 1 } }], ["missing table", { capacities: { t_1: 2, t_2: 4 } }], ["cap 101", { capacities: { t_1: 2, t_2: 4, t_3: 101 } }],
  ["dup weekday", { opening_hours: [{ weekday: "mon", opens: "10:00", closes: "12:00" }, { weekday: "mon", opens: "13:00", closes: "14:00" }] }], ["missing field", { slot_minutes: undefined }]])
  eq("policy 422 " + n, (await call("POST", "/restaurants/r_anker/policies", pol(over), auth(mgr, "bad-" + n))).s, 422);
let r = await call("POST", "/restaurants/r_anker/policies", pol(), auth(mgr, "p-ok"));
eq("policy 201 v1", [r.s, r.b.policy_version, r.b.effective_from], [201, 1, "2027-03-10"]);
eq("policy replay 200", (await call("POST", "/restaurants/r_anker/policies", pol(), auth(mgr, "p-ok"))).s, 200);
eq("policy reuse 409", (await call("POST", "/restaurants/r_anker/policies", pol({ slot_minutes: 60 }), auth(mgr, "p-ok"))).s, 409);
r = await call("POST", "/restaurants/r_anker/policies", pol({ effective_from: "2027-03-01", reservation_duration_minutes: 60 }), auth(mgr, "p-2"));
eq("older effective date gets v2", r.b.policy_version, 2);
r = await call("POST", "/restaurants/r_anker/policies", pol({ slot_minutes: 60 }), auth(mgr, "p-3"));
eq("same-date later policy v3", r.b.policy_version, 3);
eq("list order & public", (await call("GET", "/restaurants/r_anker/policies")).b.policies.map((p) => p.policy_version), [1, 2, 3]);
eq("detail still fixture", (await call("GET", "/restaurants/r_anker")).b.reservation_duration_minutes, 90);

// ---- selection by local date: 2027-03-08 (Mon) -> v2 (60 min), 2027-03-15 (Mon) -> v3 (slot 60, 120 min), 2027-02-22 (Mon) -> policy 0
const av = async (date, extra = "") => (await call("GET", `/availability?restaurant_id=r_anker&date=${date}&party_size=3${extra}`)).b;
eq("policy 0 before any", (await av("2027-02-22", "&explain=true")).slots[0].explain[0].policy_version, 0);
eq("v2 on 03-08", (await av("2027-03-08", "&explain=true")).slots[0].explain[0].policy_version, 2);
let a15 = await av("2027-03-15", "&explain=true");
eq("v3 on 03-15 (60 min grid)", [a15.slots[0].explain[0].policy_version, a15.slots.map((s) => s.starts_at_local.slice(11)).join(",")], [3, "18:00,19:00,20:00,21:00"]);
eq("v3 closed on tuesday", (await av("2027-03-16")).slots, []);
eq("explain capacity per policy", a15.slots[0].explain.map((e) => [e.table_id, e.available, e.rules[0].holds]), [["t_1", false, false], ["t_2", true, true], ["t_3", true, true]]);
eq("no explain by default", "explain" in (await av("2027-03-15")).slots[0], false);
for (const v of ["false", "1", ""]) eq("explain=" + v + " 422", (await call("GET", `/availability?restaurant_id=r_anker&date=2027-03-15&party_size=3&explain=${v}`)).s, 422);

// ---- series on policy 0 week then policy change
await call("POST", "/_test/reset", fx);
const ada2 = await login("ada@example.com"), mgr2 = await login("mgr@example.com");
const book = await call("POST", "/reservations", { restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2027-03-01T19:00", party_size: 3 }, auth(ada2, "b1"));
eq("anchor booked", [book.s, book.b.revision, book.b.accepted_terms.policy_version], [201, 1, 0]);
const ref = book.b.reference;
eq("series 401", (await call("POST", "/series", { anchor_reference: ref, count: 3, interval_weeks: 1 }, { "Idempotency-Key": "s1" })).s, 401);
for (const [n, body] of [["count 1", { count: 1, interval_weeks: 1 }], ["count 13", { count: 13, interval_weeks: 1 }], ["count bool", { count: true, interval_weeks: 1 }], ["interval 5", { count: 3, interval_weeks: 5 }], ["interval 0", { count: 3, interval_weeks: 0 }]])
  eq("series 422 " + n, (await call("POST", "/series", { anchor_reference: ref, ...body }, auth(ada2, "s-" + n))).s, 422);
eq("series 404 other owner", (await call("POST", "/series", { anchor_reference: ref, count: 3, interval_weeks: 1 }, auth(mgr2, "s-x"))).s, 404);
// a future policy makes week 3 (03-15) impossible: Tuesday-only hours
await call("POST", "/restaurants/r_anker/policies", pol({ effective_from: "2027-03-15", opening_hours: [{ weekday: "tue", opens: "18:00", closes: "23:00" }] }), auth(mgr2, "q1"));
const fail1 = await call("POST", "/series", { anchor_reference: ref, count: 4, interval_weeks: 1 }, auth(ada2, "s-fail"));
eq("series fails at first bad occurrence", [fail1.s, fail1.b.error.code], [422, "outside_opening_hours"]);
eq("nothing persisted", (await call("GET", "/reservations", undefined, auth(ada2))).b.reservations.length, 1);
const ok = await call("POST", "/series", { anchor_reference: ref, count: 2, interval_weeks: 1 }, auth(ada2, "s-ok"));
eq("series 201", [ok.s, ok.b.revision, ok.b.occurrences.length, ok.b.occurrences[0].reference], [201, 1, 2, ref]);
eq("occurrence 1 date", ok.b.occurrences[1].reservation.starts_at_local, "2027-03-08T19:00");
eq("replay 200 same body", JSON.stringify((await call("POST", "/series", { anchor_reference: ref, count: 2, interval_weeks: 1 }, auth(ada2, "s-ok"))).b), JSON.stringify(ok.b));
eq("already in series", (await call("POST", "/series", { anchor_reference: ref, count: 2, interval_weeks: 1 }, auth(ada2, "s-again"))).b.error.code, "already_in_series");
eq("GET series owner", (await call("GET", `/series/${ok.b.series_id}`, undefined, auth(ada2))).s, 200);
eq("GET series other 404", (await call("GET", `/series/${ok.b.series_id}`, undefined, auth(mgr2))).s, 404);
eq("GET series anon 404", (await call("GET", `/series/${ok.b.series_id}`)).s, 404);
eq("list has both", (await call("GET", "/reservations", undefined, auth(ada2))).b.reservations.length, 2);

const pre = await call("POST", "/reservations", { restaurant_id: "r_anker", table_id: "t_3", starts_at_local: "2027-03-23T19:00", party_size: 3 }, auth(ada2, "b-pre"));
// ---- export / import round trip keeps policies and series; stage-1-style export imports
const ex = (await call("GET", "/_test/export")).b;
eq("export has series+policies", [ex.state.series.length, ex.state.restaurants[0].policies.length], [1, 1]);
eq("import 204", (await call("POST", "/_test/import", ex)).s, 204);
eq("series survives import", (await call("GET", `/series/${ok.b.series_id}`, undefined, auth(ada2))).b.occurrences.length, 2);
eq("series replay survives import", (await call("POST", "/series", { anchor_reference: ref, count: 2, interval_weeks: 1 }, auth(ada2, "s-ok"))).s, 200);
const old = structuredClone(ex);
old.state.version = 1; delete old.state.series; delete old.state.seq.series;
for (const rs of old.state.restaurants) { delete rs.policies; delete rs.revision; delete rs.manager_user_ids; delete rs.combinable; }
for (const rv of old.state.reservations) { delete rv.revision; delete rv.accepted_terms; delete rv.history; delete rv.series_id; rv.table_id = rv.table_ids[0]; delete rv.table_ids; }
old.state.idempotency = {};
eq("stage-1 style export imports", (await call("POST", "/_test/import", old)).s, 204);
const stillAnchor = (await call("GET", `/reservations/${ref}`, undefined, auth(ada2))).b;
eq("imported booking has stage-3 fields", [stillAnchor.revision, stillAnchor.accepted_terms.policy_version], [1, 0]);
const adopt = await call("POST", "/series", { anchor_reference: pre.b.reference, count: 2, interval_weeks: 1 }, auth(ada2, "s-imp"));
eq("adopt imported reservation", [adopt.s, adopt.b.error && adopt.b.error.code], [201, undefined]);
eq("bad import 422", (await call("POST", "/_test/import", { ...ex, state: { ...ex.state, series: [{ series_id: "x" }] } })).s, 422);
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
