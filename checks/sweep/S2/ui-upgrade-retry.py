from ui_lib import *

# F17: a booking whose response was lost before export stays retryable after import into a fresh
# service process; the signed-in browser stays signed in; the UI recovers the original reference.
# Both processes run the same stage folder; the browser is pointed at the new one via request rewrite.
def check():
    errs = []
    with server() as (base1, api1), server() as (base2, api2), browser() as page:
        login(page, base1)
        page.goto(base1 + "/"); search(page, 2)
        tid(page, "slot-t_3-19:00").click(); tid(page, "booking-form").wait_for(timeout=3000)
        sent = []
        def lose(route):
            r = route.fetch(); sent.append(r.json()); route.abort("connectionreset")
        page.route("**/reservations", lose)
        tid(page, "booking-submit").click(); page.wait_for_timeout(1500)
        page.unroute("**/reservations")
        if not sent: return "no booking sent"
        s, ex = api1.call("GET", "/_test/export")
        s2, _ = api2.call("POST", "/_test/import", ex)
        if s2 != 204: return "import %s" % s2
        # every later browser request goes to the upgraded process
        page.route(base1 + "/**", lambda route: route.continue_(url=route.request.url.replace(base1, base2)))
        tid(page, "booking-submit").click()
        tid(page, "confirmation").wait_for(timeout=5000)
        if tid(page, "confirmation-reference").inner_text() != sent[0].get("reference"): errs.append("retry after upgrade gave %r, original %r" % (tid(page, "confirmation-reference").inner_text(), sent[0].get("reference")))
        if not tid(page, "current-user").count(): errs.append("signed out after upgrade")
        tok = api2.token()
        n = len(api2.call("GET", "/reservations", headers={"authorization": "Bearer " + tok})[1]["reservations"])
        if n != 1: errs.append("upgraded service holds %d bookings" % n)
        tid(page, "nav-lookup").count()
        page.goto(base1 + "/lookup")
        tid(page, "lookup-reference-input").fill(sent[0]["reference"]); tid(page, "lookup-submit").click()
        tid(page, "reservation-detail").wait_for(timeout=5000)
        if not tid(page, "current-user").count(): errs.append("signed out on /lookup after upgrade")
    return "; ".join(errs) or True

report("ui-upgrade-retry", "A booking whose response was lost before export remains retryable after import with the same body and key; the UI must recover the original confirmation.", check)
