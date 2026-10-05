// HTTP server: 0.0.0.0, PORT (default 8080), JSON in and out, every failure in the one error envelope.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, errorBody } from "./errors.ts";
import { makeBodyReaders, Router } from "./router.ts";
import { authenticate } from "./auth.ts";
import { registerCoreRoutes } from "./routes.ts";
import { register as registerReservations } from "./reservations.ts";
import { register as registerMoves } from "./moves.ts";

const router = new Router();
registerCoreRoutes(router);
registerReservations(router);
registerMoves(router);

const MAX_BODY = 64 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new ApiError(400, "malformed_request", "body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (status === 204 || body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();
    let path = url.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const raw = await readBody(req);
    const m = router.match(method, path);
    if (!m) throw new ApiError(404, "not_found", "no such route");
    const user = m.route.opts.auth ? authenticate(req.headers) : null;
    const out = await m.route.handler({
      method, path, params: m.params, query: url.searchParams, headers: req.headers, user, ...makeBodyReaders(raw),
    });
    send(res, out.status, out.body);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, errorBody(e));
    console.error(e);
    send(res, 500, errorBody(new ApiError(500, "internal_error", "internal error")));
  }
}

const port = Number(process.env.PORT) || 8080;
const server = createServer((req, res) => { void handle(req, res); });
server.keepAliveTimeout = 65_000;
server.listen(port, "0.0.0.0", () => console.log(`tablekeeper listening on ${port}`));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
