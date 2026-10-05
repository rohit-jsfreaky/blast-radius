# Run

Build and start (from this folder):

```
docker build -t tablekeeper . && docker run --rm -e PORT=8080 -p 8080:8080 tablekeeper
```

Health check: `curl http://localhost:8080/health` returns `{"status":"ok"}`.

No dependencies are installed and nothing is downloaded at run time. The service
runs TypeScript directly on Node 22 (built-in type stripping) and keeps all state in memory.
Without Docker: `node --disable-warning=ExperimentalWarning src/server.ts` (Node 22.18 or newer).
