import { run, J } from "./lib.mjs";
await run("f12-options-order", "Singles first in fixture order, then pairs in `combinable` order. `table_ids` within a pair is in `combinable` order.", async (call, h) => {
  const r = await call("POST", "/_test/reset", { users: [], reservations: [], restaurants: [{ id: "r_anker", name: "A", timezone: "Europe/Berlin", slot_minutes: 30, reservation_duration_minutes: 90, cancellation_cutoff_minutes: 0,
    opening_hours: [{ weekday: "thu", opens: "18:00", closes: "23:00" }],
    tables: [{ id: "t_c", label: "C", capacity: 2 }, { id: "t_a", label: "A", capacity: 2 }, { id: "t_b", label: "B", capacity: 2 }],
    combinable: [["t_b", "t_a"], ["t_c", "t_b"]] }] });
  if (r.s !== 204) return `reset ${r.s}`;
  const s1 = (await h.slot("2027-09-23", 2))[0];
  const want1 = [{ table_ids: ["t_c"], capacity: 2 }, { table_ids: ["t_a"], capacity: 2 }, { table_ids: ["t_b"], capacity: 2 }, { table_ids: ["t_b", "t_a"], capacity: 4 }, { table_ids: ["t_c", "t_b"], capacity: 4 }];
  if (J(s1.available_options) !== J(want1)) return `party 2 options ${J(s1.available_options)}`;
  if (J(s1.available_table_ids) !== J(["t_c", "t_a", "t_b"])) return `available_table_ids ${J(s1.available_table_ids)}`;
  const s3 = (await h.slot("2027-09-23", 3))[0];
  if (J(s3.available_table_ids) !== "[]") return `party 3 singles ${J(s3.available_table_ids)}`;
  return J(s3.available_options) === J(want1.slice(3)) ? true : `party 3 options ${J(s3.available_options)}`;
});
