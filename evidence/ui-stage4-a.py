# builder-a: an applied seating plan must show in the existing screens (availability grid, lookup), in a real browser.
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18086"
OUT = "evidence/screens-stage4"
hours = [{"weekday": d, "opens": "17:00", "closes": "23:00"} for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")]
FX = {"users": [{"id": "u_ada", "email": "ada@example.com", "password": "correct horse", "display_name": "Ada"},
                {"id": "u_mgr", "email": "mgr@example.com", "password": "correct horse", "display_name": "Mgr"}],
      "restaurants": [{"id": "r1", "name": "Zum Anker", "timezone": "Europe/Berlin", "slot_minutes": 30, "reservation_duration_minutes": 90,
                       "cancellation_cutoff_minutes": 120, "manager_user_ids": ["u_mgr"], "combinable": [["t1", "t2"]], "opening_hours": hours,
                       "tables": [{"id": "t1", "label": "1", "capacity": 2}, {"id": "t2", "label": "2", "capacity": 4}, {"id": "t3", "label": "Window", "capacity": 4}]}],
      "reservations": [{"id": "a", "reference": "AAAAAA", "user_id": "u_ada", "restaurant_id": "r1", "table_id": "t2", "party_size": 3, "starts_at_local": "2027-06-10T19:00"}]}


def call(method, path, body=None, headers=None):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=h, method=method)
    t = urllib.request.urlopen(req).read()
    return json.loads(t) if t else None


fails = []


def check(n, c):
    print(("ok   " if c else "FAIL ") + n)
    if not c:
        fails.append(n)


def tid(page, t):
    return page.locator('[data-testid="%s"]' % t)


def shot(page, name):
    time.sleep(0.5)
    page.screenshot(path="%s/%s.png" % (OUT, name), full_page=True)


call("POST", "/_test/reset", FX)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
    for w, tag in ((1280, "desktop"), (375, "phone")):
        call("POST", "/_test/reset", FX)
        page = b.new_context(viewport={"width": w, "height": 900}).new_page()
        page.goto(BASE + "/login")
        tid(page, "login-email").fill("ada@example.com")
        tid(page, "login-password").fill("correct horse")
        tid(page, "login-submit").click()
        tid(page, "current-user").wait_for()
        page.goto(BASE + "/lookup")
        tid(page, "lookup-reference-input").fill("AAAAAA")
        tid(page, "lookup-submit").click()
        tid(page, "reservation-detail").wait_for()
        check(tag + " before: Table 2", "Table 2" in tid(page, "reservation-tables").inner_text())
        mgr = call("POST", "/auth/login", {"email": "mgr@example.com", "password": "correct horse"})["token"]
        H = lambda k: {"Authorization": "Bearer " + mgr, "Idempotency-Key": k}
        plan = call("POST", "/restaurants/r1/replans", {"table_id": "t2", "from": "2027-06-10T18:00:00+02:00", "to": "2027-06-10T23:00:00+02:00"}, H("p-" + tag))
        call("POST", "/restaurants/r1/replans/%s/apply" % plan["plan_id"], {}, H("a-" + tag))
        tid(page, "lookup-submit").click()
        page.wait_for_function("document.querySelector('[data-testid=reservation-tables]') && document.querySelector('[data-testid=reservation-tables]').innerText.includes('Window')")
        check(tag + " after: Table Window", "Window" in tid(page, "reservation-tables").inner_text())
        shot(page, tag + "-1-lookup-after-plan")
        page.goto(BASE + "/")
        page.wait_for_function("document.querySelector('[data-testid=restaurant-select]').options.length>0")
        tid(page, "date-input").fill("2027-06-10")
        tid(page, "party-size-input").fill("2")
        tid(page, "search-button").click()
        tid(page, "availability-grid").wait_for()
        check(tag + " closed table cell false", tid(page, "slot-t2-19:00").get_attribute("data-available") == "false")
        check(tag + " moved-to table cell false", tid(page, "slot-t3-19:00").get_attribute("data-available") == "false")
        check(tag + " other table free", tid(page, "slot-t1-19:00").get_attribute("data-available") == "true")
        check(tag + " closure covers the evening", tid(page, "slot-t2-21:00").get_attribute("data-available") == "false")
        check(tag + " pair with closed table false", tid(page, "slot-t1+t2-19:00").get_attribute("data-available") == "false")
        shot(page, tag + "-2-grid-after-plan")
        sw = page.evaluate("document.documentElement.scrollWidth")
        check(tag + " no h-scroll", sw <= w)
    b.close()
print("FAILED: %s" % fails if fails else "ALL OK")
sys.exit(1 if fails else 0)
