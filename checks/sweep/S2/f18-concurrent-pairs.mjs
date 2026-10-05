import { run, J, fx } from "./lib.mjs";
await run("f18-concurrent-pairs", "Concurrent requests must produce the same results as executing them one at a time in some order", async (call, h) => {
  const t = await h.login(); const u = await h.login("bob@example.com");
  const bodies = [{ table_ids: ["t_1", "t_2"], party_size: 5 }, { table_ids: ["t_2", "t_3"], party_size: 5 }, { table_id: "t_2", party_size: 2 }, { table_id: "t_1", party_size: 1 }, { table_id: "t_3", party_size: 1 }];
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => h.book(i % 2 ? t : u, { restaurant_id: "r_anker", starts_at_local: `2027-09-23T${["19:00", "19:30", "20:00"][i % 3]}`, ...bodies[i % 5] })));
  if (rs.some((r) => r.s >= 500)) return "5xx under load";
  const ok = rs.filter((r) => r.s === 201).map((r) => r.b);
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const a = ok[i], b = ok[j];
    if (a.table_ids.some((x) => b.table_ids.includes(x)) && Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at)) return `overlap ${a.reference} ${J(a.table_ids)} / ${b.reference} ${J(b.table_ids)}`;
  }
  await call("POST", "/_test/reset", fx());
  const t2 = await h.login();
  const body = { restaurant_id: "r_anker", table_ids: ["t_1", "t_2"], starts_at_local: "2027-09-23T21:00", party_size: 3 };
  const same = await Promise.all(Array.from({ length: 20 }, () => h.book(t2, body, "same-key")));
  const first = same.find((x) => x.s === 201);
  const c = same.filter((r) => r.s === 201).length, rep = same.filter((r) => r.s === 200);
  if (c !== 1 || rep.length !== 19 || rep.some((r) => J(r.b) !== J(first.b))) return `same key: ${c}x201 ${rep.length}x200`;
  const list = (await call("GET", "/reservations", undefined, h.auth(t2))).b.reservations;
  return list.length === 1 ? true : `same key made ${list.length} bookings`;
});
