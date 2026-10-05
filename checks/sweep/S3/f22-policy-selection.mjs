import { run, J, errs, policy, hours } from "./lib.mjs";
await run("f22-policy-selection", "For a booking's **local start date**, choose the greatest `effective_from` not later than that date; ties choose the greatest `policy_version`.", async (call, h) => {
  const e = errs();
  const v = async (body, rid = "r_anker") => { const r = await h.publish(body, rid); e.check(r.s === 201, `publish ${r.s} ${J(r.b)}`); return r.b?.policy_version; };
  e.check(await v(policy({ effective_from: "2027-10-07", reservation_duration_minutes: 120 })) === 1, "first version not 1");
  e.check(await v(policy({ effective_from: "2027-10-07", reservation_duration_minutes: 150 })) === 2, "second version not 2");
  e.check(await v(policy({ effective_from: "2027-10-01", reservation_duration_minutes: 60 })) === 3, "third version not 3");
  const pv = async (date) => { const a = await h.avail(date, 2, "r_anker", "&explain=true"); return a.slots?.[0]?.explain?.[0]?.policy_version; };
  e.check(await pv("2027-09-30") === 0, `before all: policy ${await pv("2027-09-30")}`);
  e.check(await pv("2027-10-01") === 3, `on 10-01: policy ${await pv("2027-10-01")}`);
  e.check(await pv("2027-10-07") === 2, `same-date tie: policy ${await pv("2027-10-07")} want 2`);
  e.check(await pv("2028-01-01") === 2, `later date: policy ${await pv("2028-01-01")} want 2`);
  const b = await h.book({ table_id: "t_2", starts_at_local: "2027-10-07T19:00" });
  e.check(b.b?.accepted_terms?.policy_version === 2 && b.b?.ends_at === "2027-10-07T21:30:00+02:00", `booking terms ${b.b?.accepted_terms?.policy_version} ends ${b.b?.ends_at}`);
  // local date, not UTC date: New York 22:00 local on 2027-09-30 is 2027-10-01 UTC
  await v({ ...policy({ effective_from: "2027-10-01", reservation_duration_minutes: 30, capacities: { n_1: 4 }, opening_hours: hours("00:00", "23:30") }) }, "r_ny");
  const ny = await h.book({ restaurant_id: "r_ny", table_id: "n_1", starts_at_local: "2027-09-30T22:00" });
  e.check(ny.b?.accepted_terms?.policy_version === 0 && ny.b?.ends_at === "2027-09-30T23:00:00-04:00", `NY late-evening booking took policy ${ny.b?.accepted_terms?.policy_version}, ends ${ny.b?.ends_at}`);
  const det = (await call("GET", "/restaurants/r_anker")).b;
  e.check(det.reservation_duration_minutes === 90 && !("policies" in det), `restaurant detail changed ${J(det).slice(0, 120)}`);
  const list = (await call("GET", "/restaurants/r_anker/policies")).b;
  e.check(J(list?.policies?.map((p) => p.policy_version)) === "[1,2,3]", `policies list ${J(list).slice(0, 120)}`);
  return e.result();
});
