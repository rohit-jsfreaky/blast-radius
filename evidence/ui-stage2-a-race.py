# builder-a: out-of-order search + lost response across an export/import upgrade, in a real browser.
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18091"
FXS = open("evidence/ui-stage2-a.py").read()
ns = {}
exec(FXS[FXS.index("FX = "):FXS.index("def post")], ns)
FX = ns["FX"]


def call(method, path, body=None, headers=None):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=h, method=method)
    r = urllib.request.urlopen(req)
    t = r.read()
    return json.loads(t) if t else None


fails = []


def check(n, c):
    print(("ok   " if c else "FAIL ") + n)
    if not c:
        fails.append(n)


def tid(page, t):
    return page.locator('[data-testid="%s"]' % t)


call("POST", "/_test/reset", FX)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    page.goto(BASE + "/login")
    tid(page, "login-email").fill("ada@example.com")
    tid(page, "login-password").fill("correct horse")
    tid(page, "login-submit").click()
    tid(page, "current-user").wait_for()
    page.goto(BASE + "/")
    page.wait_for_function("document.querySelector('[data-testid=restaurant-select]').options.length>1")
    # --- out of order: search A (Zum Anker) is delayed, search B (Bistro Blau) returns first
    page.evaluate("""() => { const f = window.fetch; window.__slow = true; window.fetch = (u, o) => (window.__slow && String(u).includes('r_anker') ? new Promise(r => setTimeout(r, 1500)).then(() => f(u, o)) : f(u, o)); }""")
    tid(page, "restaurant-select").select_option("r_anker")
    tid(page, "date-input").fill("2027-01-07")
    tid(page, "search-button").click()
    time.sleep(0.2)
    tid(page, "restaurant-select").select_option("r_b")
    tid(page, "search-button").click()
    tid(page, "availability-grid").wait_for()
    time.sleep(2.5)
    check("late A never restores over B", tid(page, "slot-t_9-17:00").count() == 1 and tid(page, "slot-t_2-18:00").count() == 0)
    check("grid titled B", "Bistro Blau" in page.locator('[data-testid="availability-grid"]').locator("xpath=..").inner_text())
    page.evaluate("window.__slow = false")
    # --- lost response, then export/import, then retry with the same key
    tid(page, "restaurant-select").select_option("r_anker")
    tid(page, "party-size-input").fill("2")
    tid(page, "search-button").click()
    page.wait_for_function("document.querySelector('[data-testid=\"slot-t_2-20:00\"]')")
    tid(page, "slot-t_2-20:00").click()
    state = {"n": 0}
    keys = []

    def lose_first(route):
        if route.request.method != "POST":
            return route.continue_()
        keys.append(route.request.headers.get("idempotency-key"))
        state["n"] += 1
        if state["n"] == 1:
            route.fetch()
            route.abort()
        else:
            route.continue_()

    page.route("**/reservations", lose_first)
    tid(page, "booking-submit").click()
    tid(page, "booking-uncertain").wait_for()
    exported = call("GET", "/_test/export")
    exported["state"]["_upgrade_marker"] = True
    call("POST", "/_test/import", exported)
    tid(page, "booking-submit").click()
    tid(page, "confirmation-reference").wait_for()
    ref = tid(page, "confirmation-reference").inner_text()
    check("same key after import", len(keys) == 2 and keys[0] == keys[1])
    check("still signed in", tid(page, "current-user").count() == 1)
    mine = call("GET", "/reservations", headers={"Authorization": "Bearer " + json.loads(page.evaluate("localStorage.getItem('tk.session')"))["token"]})
    check("exactly one booking for that slot", len([r for r in mine["reservations"] if r["starts_at_local"] == "2027-01-07T20:00"]) == 1)
    check("reference matches original", any(r["reference"] == ref for r in mine["reservations"]))
    b.close()
print("FAILED: %s" % fails if fails else "ALL OK")
sys.exit(1 if fails else 0)
