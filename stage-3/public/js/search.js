// "/": search, availability grid, booking form, confirmation.
// Rules that shape this file:
//  - Latest search wins: every request takes a ticket; an older answer is dropped, never painted.
//  - The server is the only authority: a cell is available exactly when the API listed it.
//  - A booking attempt owns one idempotency key + body. Unchanged retry = same key + same body.
import { h, icon, clear } from "./dom.js";
import { api, canonical, errCode, newKey } from "./api.js";
import { getSession } from "./session.js";
import { dayLabel, hhmm, idsOf, tableWords, todayLocal } from "./format.js";

const TABLE_ART = `<svg viewBox="0 0 240 150" fill="none" stroke="#0a0b0c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M30 70h180M48 70v62M192 70v62M20 56c30-14 170-14 200 0"/><ellipse cx="120" cy="46" rx="34" ry="9"/><circle cx="120" cy="36" r="6" stroke="#2e7d55"/>
  <path d="M60 70c-4-18-4-30 0-38M180 70c4-18 4-30 0-38" /><path d="M96 24c4-8 4-12 0-18" stroke="#2e7d55"/></svg>`;

function svgNode(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export function renderSearch(root) {
  document.title = "Find a table · Tablekeeper";
  // ---- state -------------------------------------------------------------
  let ticket = 0;            // increments on every request; only the newest may paint
  let latest = null;         // params of the newest user search
  let shown = null;          // { params, restaurant, slots } currently painted
  let sel = null;            // { ids: [..], local } selected cell
  let attempt = null;        // { canon, key, closed } current booking attempt identity
  let sending = false;
  let restaurants = [];

  // ---- search panel ------------------------------------------------------
  const restSel = h("select", { class: "input", id: "restaurant-select", testid: "restaurant-select" });
  const dateIn = h("input", { class: "input", id: "date-input", type: "date", value: todayLocal(), testid: "date-input" });
  const partyIn = h("input", { class: "input", id: "party-size-input", type: "number", min: "1", inputmode: "numeric", value: "2", testid: "party-size-input" });
  const searchBtn = h("button", { class: "btn btn-primary", type: "submit", testid: "search-button" }, icon("magnifying-glass"), "Search");
  const fieldErr = h("div", { "aria-live": "polite" });
  const setBusy = (on) => {
    searchBtn.setAttribute("aria-busy", String(on));
    searchBtn.replaceChildren(on ? icon("circle-notch", "spin") : icon("magnifying-glass"), on ? "Searching…" : "Search");
  };
  let inflight = 0;

  const panel = h("form", { class: "panel", novalidate: true, onsubmit: (e) => { e.preventDefault(); startSearch(); } },
    h("div", { class: "panel-grid" },
      h("label", { class: "field field-rest" }, h("span", { class: "lab" }, "Restaurant"), restSel),
      h("label", { class: "field" }, h("span", { class: "lab" }, "Date"), dateIn),
      h("label", { class: "field" }, h("span", { class: "lab" }, "Party size"), partyIn),
      searchBtn),
    fieldErr);

  const hero = h("section", { class: "hero rise" },
    h("p", { class: "eyebrow" }, "Book a table"),
    h("h1", {}, "Where are we eating tonight?"),
    h("p", { class: "lead" }, "Pick a place, a day and how many of you. We'll show what's free."),
    h("div", { class: "hero-art", "aria-hidden": "true" }, svgNode(TABLE_ART)),
    panel);

  const results = h("section", { class: "results" });
  const gridSlot = h("div", { style: "min-width:0" });
  const formSlot = h("div", { style: "min-width:0" });
  results.append(gridSlot, formSlot);
  root.append(h("div", { class: "page" }, hero, results));

  // ---- helpers -----------------------------------------------------------
  const setFormOpen = (open) => results.classList.toggle("has-form", open);

  function emptyIntro() {
    clear(gridSlot).append(h("div", { class: "card" }, h("div", { class: "empty" },
      svgNode(TABLE_ART.replace('stroke="#0a0b0c"', 'stroke="#0a0b0c" style="opacity:.85"')),
      h("h3", {}, "Your table is waiting"),
      h("p", {}, "Choose a restaurant and a date above, then tap Search to see which tables are free."))));
  }

  function skeleton() {
    const rows = Array.from({ length: 3 }, () =>
      h("div", { class: "skel-row" }, h("div", { class: "skel", style: "height:40px" }),
        h("div", { class: "skel-chips" }, Array.from({ length: 6 }, () => h("div", { class: "skel" })))));
    clear(gridSlot).append(h("div", { class: "card", "aria-busy": "true" },
      h("div", { class: "skel", style: "height:34px;width:60%;margin-bottom:18px" }), rows));
  }

  function readParams() {
    const rid = restSel.value;
    const date = dateIn.value;
    const raw = partyIn.value.trim();
    fieldErr.replaceChildren();
    const problems = [];
    if (!rid) problems.push("Pick a restaurant.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push("Pick a date.");
    if (!/^[1-9]\d{0,3}$/.test(raw)) problems.push("Enter how many are dining, 1 or more.");
    if (problems.length) {
      fieldErr.append(h("div", { class: "note note-refused", role: "alert", style: "margin-top:14px", testid: "search-validation" }, icon("prohibit"), h("div", {}, problems.join(" "))));
      return null;
    }
    return { rid, date, party: Number(raw) };
  }

  // ---- search ------------------------------------------------------------
  function startSearch() {
    const p = readParams();
    if (!p) return;
    latest = p;
    run(p, false);
  }

  async function run(p, refresh) {
    const mine = ++ticket;
    if (!refresh) { skeleton(); inflight++; setBusy(true); }
    const [detail, avail] = await Promise.all([
      api("GET", `/restaurants/${encodeURIComponent(p.rid)}`),
      api("GET", `/availability?restaurant_id=${encodeURIComponent(p.rid)}&date=${encodeURIComponent(p.date)}&party_size=${p.party}`),
    ]);
    if (!refresh) { inflight--; if (!inflight) setBusy(false); }
    if (mine !== ticket) return; // a newer request exists: this answer must not be painted
    if (!detail.ok || !avail.ok || !avail.data || !Array.isArray(avail.data.slots)) {
      if (refresh) return; // keep what is on screen; the diner can search again
      showSearchError(p, detail, avail);
      return;
    }
    shown = { params: p, restaurant: detail.data, slots: avail.data.slots };
    if (!refresh) closeForm();
    paintGrid(!refresh);
  }

  function showSearchError(p, detail, avail) {
    const notFound = detail.status === 404 || avail.status === 404;
    clear(gridSlot).append(h("div", { class: "note note-refused", role: "alert", testid: "search-error" }, icon("warning"),
      h("div", {}, h("b", {}, notFound ? "We couldn't find that restaurant." : "We couldn't load the tables."),
        notFound ? "Pick a restaurant from the list and search again." : "Check your connection, then try again.",
        h("div", { class: "acts" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => run(p, false) }, icon("arrows-clockwise"), "Try again")))));
  }

  // ---- grid --------------------------------------------------------------
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  function paintGrid(animate = false) {
    const { params, restaurant, slots } = shown;
    if (!slots.length) {
      clear(gridSlot).append(h("div", { class: "card rise" }, h("div", { class: "empty", testid: "no-slots" },
        svgNode(TABLE_ART),
        h("h3", {}, "Nothing to book that day"),
        h("p", {}, `${restaurant.name} isn't taking bookings on ${dayLabel(params.date)}. Try another date.`),
        h("button", { class: "btn btn-secondary", type: "button", onclick: () => { dateIn.focus(); dateIn.showPicker && dateIn.showPicker(); } }, icon("calendar-blank"), "Try another date"))));
      return;
    }
    const labelOf = new Map(restaurant.tables.map((t) => [t.id, t.label]));
    const times = slots.map((s) => ({ s, t: hhmm(s.starts_at_local) }));
    const cellFor = (ids, availableFn, name) => {
      return times.map(({ s, t }) => {
        const ok = availableFn(s);
        const selected = ok && sel && sel.local === s.starts_at_local && sameSet(sel.ids, ids);
        const b = h("button", {
          type: "button", class: `cell${selected ? " is-selected" : ""}`, testid: `slot-${ids.join("+")}-${t}`,
          "data-available": String(ok), "aria-disabled": ok ? undefined : "true", "aria-pressed": ok ? String(!!selected) : undefined,
          "aria-label": `${name}, ${t}, ${ok ? "free" : "not available"}`,
          onclick: () => { if (ok) pick(ids, s); },
        }, selected ? icon("check") : null, t);
        return b;
      });
    };
    const rows = restaurant.tables.map((t) =>
      h("div", { class: "row" },
        h("div", {}, h("div", { class: "row-name" }, `Table ${t.label}`), h("div", { class: "row-seats" }, `seats ${t.capacity}`)),
        h("div", { class: "chips" }, cellFor([t.id], (s) => (s.available_table_ids || []).includes(t.id), `Table ${t.label}`))));
    const capOf = new Map(restaurant.tables.map((t) => [t.id, t.capacity]));
    const pairs = (restaurant.combinable || []).filter((p) => Array.isArray(p) && p.length === 2 && p.every((id) => capOf.has(id)))
      // A pair is offered when it can seat the party by the fixture, or when the API lists it (a published policy may change capacities).
      .filter((p) => capOf.get(p[0]) + capOf.get(p[1]) >= params.party || slots.some((s) => (s.available_options || []).some((o) => Array.isArray(o.table_ids) && o.table_ids.length === 2 && sameSet(o.table_ids, p))));
    const pairRows = pairs.map((p) => {
      const name = tableWords(p.map((id) => labelOf.get(id)));
      const isFree = (s) => (s.available_options || []).some((o) => Array.isArray(o.table_ids) && o.table_ids.length === 2 && sameSet(o.table_ids, p));
      return h("div", { class: "row" },
        h("div", {}, h("div", { class: "row-name" }, name), h("div", { class: "row-seats" }, `seats ${capOf.get(p[0]) + capOf.get(p[1])}`)),
        h("div", { class: "chips" }, cellFor(p, isFree, name)));
    });
    const free = slots.filter((s) => (s.available_table_ids || []).length || (s.available_options || []).length).length;
    clear(gridSlot).append(
      h("div", { class: animate ? "card rise" : "card" },
        h("div", { class: "card-head" },
          h("div", {}, h("h2", {}, restaurant.name),
            h("p", { class: "sub" }, `${dayLabel(params.date)} · table for ${params.party} · ${free} of ${slots.length} times have a table free`)),
          h("div", { class: "legend", "aria-hidden": "true" },
            h("span", {}, h("i", { class: "l-av" }), "Free"), h("span", {}, h("i", { class: "l-un" }), "Taken"), h("span", {}, h("i", { class: "l-se" }), "Yours"))),
        h("div", { testid: "availability-grid" }, rows,
          pairRows.length ? [h("div", { class: "group-label" }, "Joined tables"), pairRows] : null)));
  }

  // ---- booking form ------------------------------------------------------
  function pick(ids, slot) {
    if (!getSession()) {
      closeForm();
      clear(formSlot);
      const prev = gridSlot.querySelector('[data-testid="auth-error"]');
      if (!prev) {
        gridSlot.prepend(h("div", { class: "note note-info", role: "alert", style: "margin-bottom:16px", testid: "auth-error" }, icon("info"),
          h("div", {}, h("b", {}, "Log in to book this table."), "It only takes a moment, and we'll keep your search here.",
            h("div", { class: "acts" }, h("a", { class: "btn btn-primary", href: "/login", "data-link": "" }, "Log in"),
              h("a", { class: "btn btn-secondary", href: "/signup", "data-link": "" }, "Create account")))));
      }
      return;
    }
    const old = gridSlot.querySelector('[data-testid="auth-error"]');
    if (old) old.remove();
    sel = { ids, local: slot.starts_at_local };
    attempt = null;
    openForm();
    paintGrid();
  }

  function closeForm() {
    sel = null; attempt = null; sending = false;
    clear(formSlot);
    setFormOpen(false);
    if (shown) paintGrid();
  }

  function openForm() {
    const { params, restaurant } = shown;
    const labelOf = new Map(restaurant.tables.map((t) => [t.id, t.label]));
    const labels = sel.ids.map((id) => labelOf.get(id) || id);
    const seats = sel.ids.reduce((n, id) => n + ((restaurant.tables.find((t) => t.id === id) || {}).capacity || 0), 0);
    const when = `${dayLabel(sel.local)}, ${hhmm(sel.local)}`;
    const party = h("input", {
      class: "input", id: "booking-party-size", type: "number", min: "1", inputmode: "numeric", value: String(params.party), testid: "booking-party-size",
      oninput: () => { conf.replaceChildren(); },
    });
    const msgs = h("div", { "aria-live": "polite" });
    const conf = h("div", { "aria-live": "polite" });
    const submit = h("button", { class: "btn btn-primary", type: "submit", testid: "booking-submit" },
      sel.ids.length > 1 ? "Book these tables" : "Book this table");
    const setSubmit = (mode) => {
      submit.setAttribute("aria-busy", String(mode === "busy"));
      submit.replaceChildren(...[
        mode === "busy" ? icon("circle-notch", "spin") : mode === "retry" ? icon("arrows-clockwise") : null,
        mode === "busy" ? "Booking…" : mode === "retry" ? "Try again" : sel.ids.length > 1 ? "Book these tables" : "Book this table"].filter(Boolean));
    };
    const form = h("form", {
      class: "sheet rise", novalidate: true, testid: "booking-form", "aria-label": "Book a table",
      onsubmit: (e) => { e.preventDefault(); book(); },
    },
      h("div", { class: "grab", "aria-hidden": "true" }),
      h("div", { class: "sheet-head" }, h("h2", {}, sel.ids.length > 1 ? "Book these tables" : "Book this table"),
        h("button", { class: "btn btn-quiet iconbtn", type: "button", "aria-label": "Close booking form", onclick: closeForm }, icon("x-circle"))),
      h("div", { class: "summary", testid: "booking-summary" },
        h("div", { class: "big" }, `${tableWords(labels)} · seats ${seats}`),
        h("div", { class: "time" }, `${restaurant.name} · ${when}`)),
      conf,
      h("label", { class: "field" }, h("span", { class: "lab" }, "Party size"), party),
      msgs,
      submit);

    async function book() {
      if (sending) return;
      const raw = party.value.trim();
      const body = { restaurant_id: params.rid, starts_at_local: sel.local, party_size: /^-?\d+$/.test(raw) ? Number(raw) : raw };
      if (sel.ids.length === 1) body.table_id = sel.ids[0]; else body.table_ids = sel.ids;
      const canon = canonical(body);
      // Same body as the last attempt that succeeded or is still unknown -> same key. Otherwise a fresh key.
      if (!attempt || attempt.canon !== canon || attempt.closed) attempt = { canon, key: newKey(), closed: false };
      const mine = attempt;
      sending = true;
      setSubmit("busy");
      const r = await api("POST", "/reservations", { body, headers: { "Idempotency-Key": mine.key }, timeout: 15000 });
      sending = false;
      if (attempt !== mine) return;
      if (r.ok && r.data && r.data.reference) {
        clear(msgs);
        showConfirmation(r.data);
        setSubmit("idle");
        refreshAfterBooking();
        return;
      }
      if (r.net || r.status >= 500) {
        // The outcome is unknown: keep key + body so Try again is safe and cannot book twice.
        clear(msgs).append(h("div", { class: "note note-uncertain", role: "status", testid: "booking-uncertain" }, icon("clock-clockwise"),
          h("div", {}, "We couldn't confirm that yet. Your booking might have gone through. Tap Try again, it's safe and won't book twice.")));
        setSubmit("retry");
        return;
      }
      mine.closed = true; // a definite refusal: the next attempt is a new request
      setSubmit("idle");
      const text = refusalText(r);
      clear(msgs).append(h("div", { class: "note note-refused", role: "alert", testid: "booking-error" }, icon("prohibit"), h("div", {}, text)));
      if (r.status === 409) refreshAfterBooking();
    }

    function showConfirmation(res) {
      const ids = idsOf(res);
      const labs = ids.map((id) => labelOf.get(id) || id);
      const ref = res.reference;
      const copyBtn = h("button", {
        class: "btn btn-secondary iconbtn", type: "button", "aria-label": "Copy reference",
        onclick: async () => { try { await navigator.clipboard.writeText(ref); copyBtn.replaceChildren(icon("check")); setTimeout(() => copyBtn.replaceChildren(icon("copy")), 1500); } catch { /* clipboard may be blocked */ } },
      }, icon("copy"));
      clear(conf).append(
        h("div", { class: "confirm rise", testid: "confirmation" },
          h("div", { class: "badge", "aria-hidden": "true" }, icon("check")),
          h("h3", {}, "You're booked"),
          h("div", { class: "refrow" }, h("span", { class: "refpill", testid: "confirmation-reference" }, ref), copyBtn),
          h("div", { class: "facts", testid: "confirmation-details" },
            h("div", {}, restaurant.name),
            h("div", {}, h("span", { testid: "confirmation-tables" }, tableWords(labs))),
            h("div", {}, `${dayLabel(res.starts_at_local)}, ${hhmm(res.starts_at_local)} · ${res.party_size} ${res.party_size === 1 ? "guest" : "guests"}`))));
    }

    clear(formSlot).append(form);
    setFormOpen(true);
    if (matchMedia("(max-width: 960px)").matches) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    party.focus({ preventScroll: true });
  }

  function refusalText(r) {
    const c = errCode(r);
    if (c === "table_unavailable") return "Someone just took that table. Here's what's still free; pick another time or table.";
    if (c === "party_exceeds_capacity") return "That's more guests than this table seats. Try a bigger table, or fewer guests.";
    if (c === "combination_not_allowed") return "Those tables can't be joined for a booking.";
    if (c === "not_on_slot_grid" || c === "outside_opening_hours" || c === "invalid_local_time") return "That time isn't available. Pick one from the list.";
    if (c === "validation_failed" || r.status === 400) return "Please check the party size: enter a whole number, 1 or more.";
    if (r.status === 401) return "Your session has ended. Log in again to book.";
    if (r.status === 404) return "That table isn't available any more. Search again to see what's free.";
    return "We couldn't book that. Please check the details and try again.";
  }

  // Refresh the grid for the newest search without touching the open booking form.
  function refreshAfterBooking() {
    if (latest) run(latest, true);
  }

  // ---- boot --------------------------------------------------------------
  emptyIntro();
  api("GET", "/restaurants").then((r) => {
    restaurants = r.ok && r.data && Array.isArray(r.data.restaurants) ? r.data.restaurants : [];
    if (!restaurants.length) {
      restSel.append(h("option", { value: "" }, r.net ? "Couldn't load restaurants" : "No restaurants yet"));
      return;
    }
    restSel.append(...restaurants.map((x) => h("option", { value: x.id }, x.name)));
  });
}
