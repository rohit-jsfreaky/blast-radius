// Tiny DOM helpers. Text is always set as text (never HTML), so server data cannot inject markup.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "testid") el.setAttribute("data-testid", v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export function icon(name, cls = "") {
  const i = document.createElement("i");
  i.className = `ic ${cls}`.trim();
  i.setAttribute("aria-hidden", "true");
  i.style.setProperty("--i", `url(/vendor/icons/${name}.svg)`);
  return i;
}
export const clear = (el) => { el.replaceChildren(); return el; };
