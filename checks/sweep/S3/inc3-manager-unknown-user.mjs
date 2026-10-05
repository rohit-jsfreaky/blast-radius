import { run, J, errs, fx } from "./lib.mjs";
// INC-3: a restaurant's manager_user_ids must name existing users, on reset and on import (sibling of INC1.5).
await run("inc3-manager-unknown-user", "Restaurants may now declare `manager_user_ids` in their reset fixture (default `[]`). Only these users may publish policies.", async (call) => {
  const e = errs();
  const f = fx(); f.restaurants[0].manager_user_ids = ["u_nobody"];
  const r = await call("POST", "/_test/reset", f);
  e.check(r.s === 422, `reset with unknown manager: ${r.s}`);
  await call("POST", "/_test/reset", fx());
  const ex = (await call("GET", "/_test/export")).b;
  const before = J(ex);
  const bad = structuredClone(ex);
  bad.state.restaurants.find((x) => x.id === "r_anker").manager_user_ids = ["u_nobody"];
  const i = await call("POST", "/_test/import", bad);
  e.check(i.s === 422, `import with unknown manager: ${i.s}`);
  if (i.s === 422) e.check(J((await call("GET", "/_test/export")).b) === before, "rejected import changed destination");
  return e.result();
});
