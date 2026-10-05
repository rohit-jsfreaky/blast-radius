// The signed-in diner: a bearer token and display name kept in this browser. Survives a server import (tokens do).
const KEY = "tk.session";
const listeners = new Set();
let current = null;
try { current = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { current = null; }

export const getSession = () => current;
export const token = () => (current ? current.token : null);
export function setSession(s) {
  current = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage may be blocked */ }
  listeners.forEach((f) => f());
}
export const onSession = (f) => { listeners.add(f); return () => listeners.delete(f); };
