// Display helpers. Times come from the restaurant's own wall-clock strings, never from the browser's time zone.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-09-24T19:00" -> "19:00" */
export const hhmm = (local) => local.slice(11, 16);

/** "2026-09-24" or a local datetime -> "Thu 24 Sep" */
export function dayLabel(s) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

export const todayLocal = () => {
  const n = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
};

/** Table labels in plain words: "Table 2", "Tables 1 + 2". */
export function tableWords(labels) {
  return labels.length === 1 ? `Table ${labels[0]}` : `Tables ${labels.join(" + ")}`;
}

export const idsOf = (r) => (Array.isArray(r.table_ids) && r.table_ids.length ? r.table_ids : r.table_id ? [r.table_id] : []);
