// /lookup: find a booking by reference, see its status and tables, cancel it.
import { h, icon, clear } from "./dom.js";
import { api, errCode } from "./api.js";
import { getSession } from "./session.js";
import { dayLabel, hhmm, idsOf, tableWords } from "./format.js";

const restaurantCache = new Map();
async function restaurantInfo(id) {
  if (restaurantCache.has(id)) return restaurantCache.get(id);
  const r = await api("GET", `/restaurants/${encodeURIComponent(id)}`);
  const info = r.ok ? r.data : null;
  if (info) restaurantCache.set(id, info);
  return info;
}

export function renderLookup(root, { navigate }) {
  document.title = "Find a booking · Tablekeeper";
  const out = h("div", { "aria-live": "polite" });
  const input = h("input", { class: "input", id: "lookup-ref", type: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", testid: "lookup-reference-input", placeholder: "e.g. K3P7QW" });
  const btn = h("button", { class: "btn btn-primary", type: "submit", testid: "lookup-submit" }, icon("magnifying-glass"), "Find booking");
  let seq = 0; // the latest lookup wins; a late answer for an earlier reference is dropped

  const errorNote = (text, extra) =>
    h("div", { class: "note note-refused", role: "alert", testid: "reservation-error" }, icon("prohibit"), h("div", {}, text, extra || null));

  async function show(ref, mine) {
    const r = await api("GET", `/reservations/${encodeURIComponent(ref)}`);
    if (mine !== seq) return;
    if (r.net || (r.status >= 500)) {
      clear(out).append(errorNote("We couldn't reach the booking system. Try again in a moment."));
      return;
    }
    if (r.status === 401) { clear(out).append(errorNote("Log in to look up your booking.", loginLink())); return; }
    if (r.status === 404 || !r.ok) {
      clear(out).append(errorNote("We can't find that reference. Check the letters and try again."));
      return;
    }
    const res = r.data;
    const info = await restaurantInfo(res.restaurant_id);
    if (mine !== seq) return;
    paint(res, info);
  }

  const loginLink = () => h("div", { class: "acts" }, h("a", { class: "btn btn-secondary", href: "/login", "data-link": "" }, "Log in"));

  function paint(res, info) {
    const labelOf = new Map(((info && info.tables) || []).map((t) => [t.id, t.label]));
    const labels = idsOf(res).map((id) => labelOf.get(id) || id);
    const status = h("span", { class: `pill pill-${res.status}`, testid: "reservation-status" }, res.status);
    const cancelled = res.status === "cancelled";
    const msg = h("div", { "aria-live": "polite" });
    const cancel = cancelled ? null : h("button", {
      class: "btn btn-secondary", type: "button", testid: "reservation-cancel-button",
      onclick: async () => {
        cancel.setAttribute("aria-busy", "true");
        cancel.disabled = true;
        const mine = seq;
        const c = await api("POST", `/reservations/${encodeURIComponent(res.reference)}/cancel`);
        if (mine !== seq) return;
        if (c.ok) { paint(c.data, info); return; }
        cancel.removeAttribute("aria-busy");
        cancel.disabled = false;
        let text = "We couldn't cancel that just now. Please try again.";
        if (c.status === 409 && errCode(c) === "cutoff_passed") text = "It's too close to the start time to cancel online. Please call the restaurant.";
        else if (c.status === 401) text = "Your session has ended. Log in again to cancel.";
        else if (c.status === 404) text = "We can't find that booking any more.";
        clear(msg).append(errorNote(text));
      },
    }, icon("x-circle"), "Cancel booking");
    clear(out).append(
      h("div", { class: "detail rise", testid: "reservation-detail" },
        h("div", { class: "top" }, h("span", { class: "refmono" }, res.reference), status),
        h("div", { class: "facts" },
          h("div", {}, h("span", { class: "k" }, "Restaurant"), info ? info.name : res.restaurant_id),
          h("div", {}, h("span", { class: "k" }, "Tables"), h("span", { testid: "reservation-tables" }, tableWords(labels))),
          h("div", {}, h("span", { class: "k" }, "When"), `${dayLabel(res.starts_at_local)}, ${hhmm(res.starts_at_local)}`),
          h("div", {}, h("span", { class: "k" }, "Party"), `${res.party_size} ${res.party_size === 1 ? "guest" : "guests"}`)),
        cancelled ? h("p", { class: "sub" }, "This booking has been cancelled.") : cancel, msg));
  }

  const form = h("form", {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const ref = input.value.trim();
      const mine = ++seq;
      if (!ref) { clear(out).append(errorNote("Enter the booking reference from your confirmation.")); return; }
      if (!getSession()) { clear(out).append(errorNote("Log in to look up your booking.", loginLink())); return; }
      btn.setAttribute("aria-busy", "true");
      clear(out).append(h("div", { class: "skel", style: "height:120px" }));
      await show(ref, mine);
      if (mine === seq) btn.removeAttribute("aria-busy");
    },
  },
    h("div", { style: "display:grid;gap:16px" },
      h("label", { class: "field" }, h("span", { class: "lab" }, "Booking reference"), input,
        h("span", { class: "hint" }, "Six to twelve letters and numbers, from your confirmation.")),
      btn));

  root.append(
    h("div", { class: "center rise" },
      h("div", { class: "card" },
        h("div", {}, h("p", { class: "eyebrow" }, "Already booked"), h("h1", { style: "margin-top:6px" }, "Find a booking"),
          h("p", { class: "sub" }, "Check your table, or cancel if plans change.")),
        form, out)));
  input.focus();
}
