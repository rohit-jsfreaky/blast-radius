# builder-a: drives the stage-2 UI in a real browser (Chrome via Playwright), checks the testid contract, takes screenshots.
import json, sys, time, urllib.request, re
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18090"
OUT = "evidence/screens-stage3"
FX = {"users": [{"id": "u_ada", "email": "ada@example.com", "password": "correct horse", "display_name": "Ada"}],
 "restaurants": [{"id": "r_anker", "name": "Zum Anker", "timezone": "Europe/Berlin", "slot_minutes": 30, "reservation_duration_minutes": 90,
   "cancellation_cutoff_minutes": 120, "combinable": [["t_1", "t_2"], ["t_2", "t_3"]],
   "opening_hours": [{"weekday": "thu", "opens": "18:00", "closes": "23:00"}],
   "tables": [{"id": "t_1", "label": "1", "capacity": 2}, {"id": "t_2", "label": "2", "capacity": 4}, {"id": "t_3", "label": "3", "capacity": 4}]},
  {"id": "r_b", "name": "Bistro Blau", "timezone": "America/New_York", "slot_minutes": 60, "reservation_duration_minutes": 60,
   "cancellation_cutoff_minutes": 30, "opening_hours": [{"weekday": "thu", "opens": "17:00", "closes": "20:00"}],
   "tables": [{"id": "t_9", "label": "Window", "capacity": 2}]}],
 "reservations": [{"id": "res_s", "reference": "SEED01", "user_id": "u_ada", "restaurant_id": "r_anker", "table_id": "t_3", "starts_at_local": "2027-01-07T19:00", "party_size": 3}]}


def post(path, body, headers=None):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=h, method="POST")
    return urllib.request.urlopen(req)


fails = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def tid(page, t):
    return page.locator('[data-testid="%s"]' % t)


def cell(page, t):
    return page.locator('[data-testid="%s"]' % t)


def shot(page, path):
    time.sleep(0.5)
    page.screenshot(path=path, full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
    for w, h_, tag in ((1280, 900, "desktop"), (375, 800, "phone")):
        post("/_test/reset", FX)
        ctx = b.new_context(viewport={"width": w, "height": h_})
        page = ctx.new_page()
        page.on("pageerror", lambda e: (print("PAGEERROR", e), fails.append("pageerror")))
        page.goto(BASE + "/")
        page.wait_for_function("document.querySelector('[data-testid=restaurant-select]') && document.querySelector('[data-testid=restaurant-select]').options.length>0")
        shot(page, "%s/%s-1-search-empty.png" % (OUT, tag))
        tid(page, "restaurant-select").select_option("r_anker")
        tid(page, "date-input").fill("2027-01-07")
        tid(page, "party-size-input").fill("4")
        tid(page, "search-button").click()
        tid(page, "availability-grid").wait_for()
        check(tag + " cell free", cell(page, "slot-t_2-18:00").get_attribute("data-available") == "true")
        check(tag + " cell taken by seed", cell(page, "slot-t_3-19:00").get_attribute("data-available") == "false")
        check(tag + " small table false for party 4", cell(page, "slot-t_1-18:00").get_attribute("data-available") == "false")
        check(tag + " pair cell exists", cell(page, "slot-t_1+t_2-18:00").count() == 1)
        shot(page, "%s/%s-2-grid.png" % (OUT, tag))
        cell(page, "slot-t_2-18:00").click()
        check(tag + " auth-error when signed out", tid(page, "auth-error").count() == 1)
        shot(page, "%s/%s-3-signed-out-click.png" % (OUT, tag))
        page.goto(BASE + "/login")
        tid(page, "login-email").fill("ada@example.com")
        tid(page, "login-password").fill("wrong")
        tid(page, "login-submit").click()
        tid(page, "auth-error").wait_for()
        shot(page, "%s/%s-4-login-error.png" % (OUT, tag))
        tid(page, "login-password").fill("correct horse")
        tid(page, "login-submit").click()
        tid(page, "current-user").wait_for()
        check(tag + " current-user has name", "Ada" in tid(page, "current-user").inner_text())
        tid(page, "restaurant-select").select_option("r_anker")
        tid(page, "date-input").fill("2027-01-07")
        tid(page, "party-size-input").fill("4")
        tid(page, "search-button").click()
        tid(page, "availability-grid").wait_for()
        cell(page, "slot-t_2-18:00").click()
        tid(page, "booking-form").wait_for()
        txt = tid(page, "booking-summary").inner_text()
        check(tag + " summary names table+time", "2" in txt and "18:00" in txt)
        check(tag + " party prefilled", tid(page, "booking-party-size").input_value() == "4")
        shot(page, "%s/%s-5-booking-form.png" % (OUT, tag))
        tid(page, "booking-submit").click()
        tid(page, "confirmation-reference").wait_for()
        ref = tid(page, "confirmation-reference").inner_text()
        check(tag + " reference exact", re.fullmatch(r"[A-Z0-9]{6,12}", ref) is not None)
        d = tid(page, "confirmation-details").inner_text()
        check(tag + " details", "Zum Anker" in d and "18:00" in d)
        check(tag + " form stays", tid(page, "booking-form").count() == 1)
        shot(page, "%s/%s-6-confirmation.png" % (OUT, tag))
        tid(page, "booking-submit").click()
        time.sleep(0.6)
        check(tag + " resubmit same ref", tid(page, "confirmation-reference").inner_text() == ref and tid(page, "booking-error").count() == 0)
        # combination booking
        tid(page, "party-size-input").fill("6")
        tid(page, "search-button").click()
        page.wait_for_function("document.querySelector('[data-testid=\"slot-t_1+t_2-21:00\"]')")
        check(tag + " combo free", cell(page, "slot-t_1+t_2-21:00").get_attribute("data-available") == "true")
        cell(page, "slot-t_1+t_2-21:00").click()
        txt = tid(page, "booking-summary").inner_text()
        check(tag + " combo summary names both", "1" in txt and "2" in txt and "21:00" in txt)
        shot(page, "%s/%s-7-combo-form.png" % (OUT, tag))
        # 409: another diner takes t_2 at 21:00 first
        tok = json.load(post("/auth/signup", {"email": "x@example.com", "password": "12345678", "display_name": "X"}))["token"]
        post("/reservations", {"restaurant_id": "r_anker", "table_id": "t_2", "starts_at_local": "2027-01-07T21:00", "party_size": 2},
             {"Authorization": "Bearer " + tok, "Idempotency-Key": "k-x"})
        tid(page, "booking-submit").click()
        tid(page, "booking-error").wait_for()
        check(tag + " 409 -> error, no confirmation, form kept", tid(page, "confirmation").count() == 0 and tid(page, "booking-form").count() == 1)
        page.wait_for_function("document.querySelector('[data-testid=\"slot-t_1+t_2-21:00\"]').getAttribute('data-available')==='false'")
        check(tag + " grid refreshed", True)
        shot(page, "%s/%s-8-refused.png" % (OUT, tag))
        # uncertain: response lost after commit, then retry with the same key
        tid(page, "party-size-input").fill("2")
        tid(page, "search-button").click()
        page.wait_for_function("document.querySelector('[data-testid=\"slot-t_3-21:00\"]')")
        cell(page, "slot-t_3-21:00").click()
        calls = []

        def handler(route):
            calls.append(route.request.headers.get("idempotency-key"))
            if len(calls) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route("**/reservations", lambda route: handler(route) if route.request.method == "POST" else route.continue_())
        tid(page, "booking-submit").click()
        tid(page, "booking-uncertain").wait_for()
        check(tag + " uncertain text, no error/confirmation", len(tid(page, "booking-uncertain").inner_text().strip()) > 5 and tid(page, "booking-error").count() == 0 and tid(page, "confirmation").count() == 0)
        shot(page, "%s/%s-9-uncertain.png" % (OUT, tag))
        tid(page, "booking-submit").click()
        tid(page, "confirmation-reference").wait_for()
        check(tag + " retry same key", len(calls) == 2 and calls[0] == calls[1])
        check(tag + " uncertainty cleared", tid(page, "booking-uncertain").count() == 0 and tid(page, "booking-error").count() == 0)
        page.unroute("**/reservations")
        ref2 = tid(page, "confirmation-reference").inner_text()
        # lookup
        page.goto(BASE + "/lookup")
        tid(page, "lookup-reference-input").fill(ref2)
        tid(page, "lookup-submit").click()
        tid(page, "reservation-detail").wait_for()
        check(tag + " lookup status", tid(page, "reservation-status").inner_text() == "confirmed")
        check(tag + " lookup tables", "3" in tid(page, "reservation-tables").inner_text())
        shot(page, "%s/%s-10-lookup.png" % (OUT, tag))
        tid(page, "lookup-reference-input").fill("NOPE99")
        tid(page, "lookup-submit").click()
        tid(page, "reservation-error").wait_for()
        shot(page, "%s/%s-11-lookup-notfound.png" % (OUT, tag))
        tid(page, "lookup-reference-input").fill(ref2)
        tid(page, "lookup-submit").click()
        tid(page, "reservation-cancel-button").wait_for()
        tid(page, "reservation-cancel-button").click()
        page.wait_for_function("document.querySelector('[data-testid=reservation-status]').innerText==='cancelled'")
        check(tag + " cancel button gone", tid(page, "reservation-cancel-button").count() == 0)
        shot(page, "%s/%s-12-lookup-cancelled.png" % (OUT, tag))
        # closed day, no horizontal scroll
        page.goto(BASE + "/")
        page.wait_for_function("document.querySelector('[data-testid=restaurant-select]').options.length>0")
        tid(page, "restaurant-select").select_option("r_anker")
        tid(page, "date-input").fill("2027-01-08")
        tid(page, "search-button").click()
        tid(page, "no-slots").wait_for()
        shot(page, "%s/%s-13-no-slots.png" % (OUT, tag))
        for path in ("/", "/signup", "/login", "/lookup"):
            page.goto(BASE + path)
            time.sleep(0.3)
            sw = page.evaluate("document.documentElement.scrollWidth")
            iw = page.evaluate("window.innerWidth")
            check("%s no h-scroll %s (%s<=%s)" % (tag, path, sw, iw), sw <= iw)
        page.goto(BASE + "/signup")
        shot(page, "%s/%s-14-signup.png" % (OUT, tag))
        ctx.close()
    b.close()
print("FAILED: %s" % fails if fails else "ALL OK")
sys.exit(1 if fails else 0)
