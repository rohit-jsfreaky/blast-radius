// Entry: top bar (same on every route), client-side router, route -> view.
import { h, icon, clear } from "./dom.js";
import { getSession, setSession, onSession } from "./session.js";
import { renderSearch } from "./search.js";
import { renderLogin, renderSignup } from "./auth.js";
import { renderLookup } from "./lookup.js";

const app = document.getElementById("app");
const topRoot = document.getElementById("topbar-root");
const routes = { "/": renderSearch, "/login": renderLogin, "/signup": renderSignup, "/lookup": renderLookup };

export function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname) history[replace ? "replaceState" : "pushState"]({}, "", path);
  render(true);
}

function renderTopbar() {
  const s = getSession();
  const here = location.pathname;
  const link = (href, label, ic, testid) =>
    h("a", { href, "data-link": "", testid, "aria-current": here === href ? "page" : undefined }, icon(ic), label);
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    link("/", "Search", "magnifying-glass", "nav-search"),
    link("/lookup", "Find a booking", "calendar-blank", "nav-lookup"),
    s
      ? [
          h("span", { class: "who", testid: "current-user" }, h("span", { class: "av", "aria-hidden": "true" }, [...s.display_name][0] || "?"), s.display_name),
          h("button", {
            class: "linklike", type: "button", testid: "logout-button",
            onclick: () => { setSession(null); navigate("/"); },
          }, icon("sign-out"), "Log out"),
        ]
      : [link("/login", "Log in", "user", "nav-login"), link("/signup", "Sign up", "plus", "nav-signup")]);
  clear(topRoot).append(
    h("header", { class: "topbar" },
      h("div", { class: "topbar-in" },
        h("a", { class: "brand", href: "/", "data-link": "" }, h("span", { class: "mark", "aria-hidden": "true" }, icon("storefront")), "Tablekeeper"),
        nav)));
}

let first = true;
function render(moved) {
  renderTopbar();
  clear(app);
  const view = routes[location.pathname] || renderSearch;
  view(app, { navigate });
  if (moved && !first) document.getElementById("main").focus({ preventScroll: true });
  if (moved) window.scrollTo(0, 0);
  first = false;
}

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-link]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(new URL(a.href).pathname);
});
window.addEventListener("popstate", () => render(true));
// Signing in or out changes the top bar only; the screen below keeps its state (forms, search, booking in progress).
onSession(renderTopbar);
render(false);
