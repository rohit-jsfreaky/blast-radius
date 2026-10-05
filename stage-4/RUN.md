# Run

Build and start (from this folder):

```
docker build -t tablekeeper . && docker run --rm -e PORT=8080 -p 8080:8080 tablekeeper
```

Health check: `curl http://localhost:8080/health` returns `{"status":"ok"}`.

No dependencies are installed and nothing is downloaded at run time. The service
runs TypeScript directly on Node 22 (built-in type stripping) and keeps all state in memory.
Without Docker: `node --disable-warning=ExperimentalWarning src/server.ts` (Node 22.18 or newer).

## Screens

The same service serves the browser UI: `/` (search and availability), `/signup`, `/login`, `/lookup`.
Fonts (Shantell Sans, Hanken Grotesk) and icons (Phosphor) are npm packages fetched during `docker build`
(`scripts/vendor.sh`) and served from `/vendor/`; nothing is loaded from the network at run time.
