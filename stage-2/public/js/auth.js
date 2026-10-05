// /signup and /login: one centred card each.
import { h, icon } from "./dom.js";
import { api, errCode } from "./api.js";
import { setSession } from "./session.js";

function authCard(root, { title, intro, fields, submitLabel, busyLabel, path, build, errorFor, swap, navigate }) {
  const err = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn btn-primary", type: "submit", testid: `${path}-submit` }, submitLabel);
  const inputs = fields.map((f) =>
    h("label", { class: "field" },
      h("span", { class: "lab" }, f.label),
      h("input", { class: "input", id: `${path}-${f.name}`, name: f.name, type: f.type, autocomplete: f.auto, required: true, testid: `${path}-${f.name}` }),
      f.hint ? h("span", { class: "hint" }, f.hint) : null));
  let busy = false;
  const form = h("form", {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      err.replaceChildren();
      btn.setAttribute("aria-busy", "true");
      btn.replaceChildren(icon("circle-notch", "spin"), busyLabel);
      const vals = Object.fromEntries(inputs.map((l, i) => [fields[i].name, l.querySelector("input").value]));
      const r = await api("POST", `/auth/${path}`, { body: build(vals) });
      busy = false;
      btn.removeAttribute("aria-busy");
      btn.replaceChildren(submitLabel);
      if (r.ok && r.data && r.data.token) {
        setSession({ token: r.data.token, user_id: r.data.user_id, display_name: r.data.display_name });
        navigate("/");
        return;
      }
      err.replaceChildren(
        h("div", { class: "note note-refused", role: "alert", testid: "auth-error" }, icon("prohibit"), h("div", {}, errorFor(r))));
    },
  }, h("div", { style: "display:grid;gap:16px" }, inputs, err, btn));
  root.append(
    h("div", { class: "center rise" },
      h("div", { class: "card" }, h("div", {}, h("h1", {}, title), h("p", { class: "sub" }, intro)), form, h("p", { class: "swap" }, swap))));
  inputs[0].querySelector("input").focus();
}

export function renderSignup(root, { navigate }) {
  document.title = "Sign up · Tablekeeper";
  authCard(root, {
    navigate, path: "signup", title: "Create your account", intro: "One account keeps all your bookings in one place.",
    fields: [
      { name: "display-name", label: "Your name", type: "text", auto: "name" },
      { name: "email", label: "Email", type: "email", auto: "email" },
      { name: "password", label: "Password", type: "password", auto: "new-password", hint: "At least 8 characters." },
    ],
    submitLabel: "Create account", busyLabel: "Creating account…",
    build: (v) => ({ email: v.email.trim(), password: v.password, display_name: v["display-name"].trim() }),
    errorFor: (r) => {
      if (r.net) return "We couldn't reach the server. Check your connection and try again.";
      const c = errCode(r);
      if (c === "email_taken") return "That email already has an account. Try logging in instead.";
      if (r.status === 422 || r.status === 400) return "Please check your details: use a real email and a password of at least 8 characters.";
      return "Something went wrong creating your account. Please try again.";
    },
    swap: h("span", {}, "Already have an account? ", h("a", { href: "/login", "data-link": "" }, "Log in")),
  });
}

export function renderLogin(root, { navigate }) {
  document.title = "Log in · Tablekeeper";
  authCard(root, {
    navigate, path: "login", title: "Welcome back", intro: "Log in to book a table and manage your reservations.",
    fields: [
      { name: "email", label: "Email", type: "email", auto: "email" },
      { name: "password", label: "Password", type: "password", auto: "current-password" },
    ],
    submitLabel: "Log in", busyLabel: "Logging in…",
    build: (v) => ({ email: v.email.trim(), password: v.password }),
    errorFor: (r) => {
      if (r.net) return "We couldn't reach the server. Check your connection and try again.";
      if (r.status === 401) return "That email and password don't match. Try again.";
      if (r.status === 422 || r.status === 400) return "Enter your email and password to log in.";
      return "Something went wrong logging you in. Please try again.";
    },
    swap: h("span", {}, "New here? ", h("a", { href: "/signup", "data-link": "" }, "Create an account")),
  });
}
