// builder-a smoke check of WI1.1-1.3 (own script, not the shipped tests)
const B = `http://localhost:${process.env.PORT || 18080}`;
const call = async (m, p, body, h = {}) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const t = await r.text(); return { s: r.status, b: t ? JSON.parse(t) : null };
};
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log("FAIL", name, JSON.stringify(got), "want", JSON.stringify(want)); } else console.log("ok  ", name); };
const fx = { users: [{ id: "u_ada", email: "ada@example.com", password: "correct horse", display_name: "Ada" }],
  restaurants: [{ id: "r_anker", name: "Zum Anker", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
    opening_hours: [{ weekday: "thu", opens: "18:00", closes: "23:00" }, { weekday: "sun", opens: "00:00", closes: "06:00" }],
    tables: [{ id: "t_1", label: "1", capacity: 2 }, { id: "t_2", label: "2", capacity: 4 }] }],
  reservations: [{ id: "res_x", reference: "ABC123", user_id: "u_ada", restaurant_id: "r_anker", table_id: "t_2", starts_at_local: "2026-09-24T19:00", party_size: 4 }] };
eq("reset", (await call("POST", "/_test/reset", fx)).s, 204);
eq("bad json", (await call("POST", "/_test/reset", "{nope")).s, 400);
let r = await call("POST", "/auth/login", { email: "ada@example.com", password: "correct horse" });
eq("login", [r.s, r.b.user_id, typeof r.b.token], [200, "u_ada", "string"]);
const tok = r.b.token;
eq("login wrong", (await call("POST", "/auth/login", { email: "ada@example.com", password: "x" })).s, 401);
eq("signup", (await call("POST", "/auth/signup", { email: "b@example.com", password: "12345678", display_name: "B" })).s, 201);
eq("signup dup", (await call("POST", "/auth/signup", { email: "b@example.com", password: "12345678" })).b.error.code, "email_taken");
eq("signup short pw", (await call("POST", "/auth/signup", { email: "c@example.com", password: "123" })).b.error.code, "validation_failed");
eq("signup bad email", (await call("POST", "/auth/signup", { email: "nope", password: "12345678" })).s, 422);
eq("signup wrong type", (await call("POST", "/auth/signup", { email: 5, password: "12345678" })).s, 400);
eq("restaurants", (await call("GET", "/restaurants")).b, { restaurants: [{ id: "r_anker", name: "Zum Anker", timezone: "Europe/Berlin" }] });
eq("restaurant 404", (await call("GET", "/restaurants/zzz")).b.error.code, "not_found");
eq("restaurant", (await call("GET", "/restaurants/r_anker")).b.tables.length, 2);
r = await call("GET", "/availability?restaurant_id=r_anker&date=2026-09-24&party_size=4");
eq("avail count", r.b.slots.length, 8);
eq("avail first", r.b.slots[0], { starts_at_local: "2026-09-24T18:00", starts_at: "2026-09-24T18:00:00+02:00", available_table_ids: [] });
eq("avail 19:00 taken", r.b.slots.filter((s) => s.available_table_ids.length === 0).map((s) => s.starts_at_local), ["2026-09-24T18:00","2026-09-24T18:30", "2026-09-24T19:00", "2026-09-24T19:30","2026-09-24T20:00"]);
eq("avail 20:30 free", r.b.slots[5].available_table_ids, ["t_2"]);
eq("avail party 1", (await call("GET", "/availability?restaurant_id=r_anker&date=2026-09-24&party_size=1")).b.slots[5].available_table_ids, ["t_1", "t_2"]);
eq("avail closed day", (await call("GET", "/availability?restaurant_id=r_anker&date=2026-09-25&party_size=2")).b.slots, []);
for (const q of ["date=2026-09-24&party_size=2", "restaurant_id=r_anker&party_size=2", "restaurant_id=r_anker&date=2026-09-24", "restaurant_id=r_anker&date=2026-09-24&party_size=4.0", "restaurant_id=r_anker&date=2026-09-24&party_size=1e1", "restaurant_id=r_anker&date=2026-09-24&party_size=%2B4", "restaurant_id=r_anker&date=2026-02-30&party_size=4", "restaurant_id=r_anker&date=2026-09-24&party_size=0"])
  eq("avail 422 " + q, (await call("GET", "/availability?" + q)).s, 422);
eq("avail unknown rest", (await call("GET", "/availability?restaurant_id=q&date=2026-09-24&party_size=2")).s, 404);
r = await call("GET", "/availability?restaurant_id=r_anker&date=2026-03-29&party_size=2");
eq("spring fwd sun 00-06: no 02:xx", r.b.slots.map((s) => s.starts_at_local.slice(11)).filter((x) => x.startsWith("02")), []);
eq("spring fwd 03:00 +02", r.b.slots.find((s) => s.starts_at_local.endsWith("T03:00")).starts_at, "2026-03-29T03:00:00+02:00");
r = await call("GET", "/availability?restaurant_id=r_anker&date=2026-10-25&party_size=2");
eq("fall back slots once", r.b.slots.filter((s) => s.starts_at_local.endsWith("T02:30")).map((s) => s.starts_at), ["2026-10-25T02:30:00+02:00"]);
eq("export 401-free", (await call("GET", "/_test/export")).b.track, "tablekeeper");
const ex = (await call("GET", "/_test/export")).b;
eq("import", (await call("POST", "/_test/import", ex)).s, 204);
eq("token survives import", (await call("POST", "/_test/import", ex)).s, 204);
eq("export stable", JSON.stringify((await call("GET", "/_test/export")).b), JSON.stringify(ex));
eq("login after import", (await call("POST", "/auth/login", { email: "ada@example.com", password: "correct horse" })).s, 200);
for (const bad of [{ ...ex, track: "x" }, { ...ex, format_version: 2 }, { track: "tablekeeper", format_version: 1 }, { ...ex, state: { ...ex.state, users: "no" } }, { ...ex, state: [] }])
  eq("import 422", (await call("POST", "/_test/import", bad)).s, 422);
eq("import junk 400", (await call("POST", "/_test/import", "[[")).s, 400);
eq("still intact", (await call("GET", "/_test/export")).b.state.reservations.length, 1);
eq("reset clears", (await call("POST", "/_test/reset", { restaurants: [] })).s, 204);
eq("login after reset", (await call("POST", "/auth/login", { email: "ada@example.com", password: "correct horse" })).s, 401);
eq("404 route", (await call("GET", "/nope")).b.error.code, "not_found");
// 50 concurrent
await call("POST", "/_test/reset", fx);
const rs = await Promise.all(Array.from({ length: 50 }, () => call("POST", "/auth/login", { email: "ada@example.com", password: "correct horse" })));
eq("50 concurrent logins", rs.every((x) => x.s === 200), true);
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
