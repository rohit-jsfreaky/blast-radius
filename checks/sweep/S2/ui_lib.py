"""Stage-2 UI family sweep (investigator). Written from spec/stage-2.md only.
Usage: python <probe>.py <repo-root | stage folder>. Starts the stage's server with node, drives Chromium."""
import json, os, socket, subprocess, sys, time, urllib.request
from contextlib import contextmanager

DATE = "2027-09-23"  # a Thursday in the future, so cutoffs never interfere

FIXTURE = {
    "users": [{"id": "u_ada", "email": "ada@example.com", "password": "correct horse", "display_name": "Ada Lovelace"},
              {"id": "u_bob", "email": "bob@example.com", "password": "correct horse", "display_name": "Bob"}],
    "restaurants": [{"id": "r_anker", "name": "Zum Anker", "timezone": "Europe/Berlin", "slot_minutes": 30,
                     "reservation_duration_minutes": 90, "cancellation_cutoff_minutes": 120,
                     "opening_hours": [{"weekday": "thu", "opens": "18:00", "closes": "23:00"}],
                     "tables": [{"id": "t_1", "label": "Window", "capacity": 2}, {"id": "t_2", "label": "Booth", "capacity": 4},
                                {"id": "t_3", "label": "Garden", "capacity": 4}],
                     "combinable": [["t_1", "t_2"], ["t_2", "t_3"]]}],
    "reservations": [],
}


def stage_dir():
    arg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BLAST_TARGET_DIR", ".")
    for d in (os.path.join(arg, "stage-2"), arg):
        if os.path.isfile(os.path.join(d, "src", "server.ts")):
            return d
    raise SystemExit("FAIL S2 no stage-2/src/server.ts under %s" % arg)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class Api:
    def __init__(self, base): self.base = base

    def call(self, method, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"content-type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                t = r.read().decode(); return r.status, (json.loads(t) if t else None)
        except urllib.error.HTTPError as e:
            t = e.read().decode(); return e.code, (json.loads(t) if t else None)

    def token(self, email="ada@example.com"):
        return self.call("POST", "/auth/login", {"email": email, "password": "correct horse"})[1]["token"]


@contextmanager
def server(d=None):
    d = d or stage_dir()
    port = free_port()
    p = subprocess.Popen([os.environ.get("NODE", "node"), "--disable-warning=ExperimentalWarning", "src/server.ts"], cwd=d,
                         env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = "http://127.0.0.1:%d" % port
    try:
        for _ in range(150):
            try:
                if urllib.request.urlopen(base + "/health", timeout=1).status == 200: break
            except Exception: time.sleep(0.1)
        api = Api(base)
        assert api.call("POST", "/_test/reset", FIXTURE)[0] == 204, "reset failed"
        yield base, api
    finally:
        p.kill()


@contextmanager
def browser(width=1280):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={"width": width, "height": 900})
        try:
            yield ctx.new_page()
        finally:
            b.close()


def tid(page, t): return page.locator('[data-testid="%s"]' % t)


def login(page, base, email="ada@example.com"):
    page.goto(base + "/login")
    tid(page, "login-email").fill(email); tid(page, "login-password").fill("correct horse"); tid(page, "login-submit").click()
    tid(page, "current-user").wait_for(timeout=5000)


def search(page, party, date=DATE, wait=True):
    tid(page, "restaurant-select").select_option("r_anker")
    tid(page, "date-input").fill(date)
    tid(page, "party-size-input").fill(str(party))
    tid(page, "search-button").click()
    if wait: tid(page, "availability-grid").wait_for(timeout=5000)


def report(name, quote, fn):
    try:
        res = fn()
    except Exception as e:  # noqa
        res = "error %s" % str(e).splitlines()[0][:300]
    if res is True:
        print('PASS S2 %s | "%s"' % (name, quote)); sys.exit(0)
    print('FAIL S2 %s | %s | "%s"' % (name, res, quote)); sys.exit(1)
