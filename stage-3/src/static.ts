// Static files and the HTML shell for the four screen routes (D5). Everything is served from ./public, offline.
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const SHELL_ROUTES = new Set(["/", "/signup", "/login", "/lookup"]);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

export interface StaticFile { type: string; body: Buffer }

/** The file for a GET path, or null when it is not a screen route or an asset (then the JSON 404 applies). */
export async function staticFor(path: string): Promise<StaticFile | null> {
  let rel: string;
  if (SHELL_ROUTES.has(path)) rel = "index.html";
  else if (path.startsWith("/css/") || path.startsWith("/js/") || path.startsWith("/vendor/") || path === "/favicon.svg") rel = path.slice(1);
  else return null;
  let decoded: string;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  const full = normalize(join(ROOT, decoded));
  if (!full.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;
  try {
    return { type: TYPES[extname(full)] ?? "application/octet-stream", body: await readFile(full) };
  } catch {
    return null;
  }
}
