from ui_lib import *

# The booking commits on the server but its response is lost. The UI must show booking-uncertain only,
# retry with the same key and body, and then show the ORIGINAL reference. Run for a single and a pair.
def one(page, base, api, cell, party):
    errs = []
    page.goto(base + "/"); search(page, party)
    tid(page, cell).click(); tid(page, "booking-form").wait_for(timeout=3000)
    sent = []
    def lose(route):
        r = route.fetch()  # reaches the server and commits
        sent.append((route.request.headers.get("idempotency-key"), route.request.post_data, r.json()))
        route.abort("connectionreset")
    page.route("**/reservations", lose)
    tid(page, "booking-submit").click()
    page.wait_for_timeout(1500)
    page.unroute("**/reservations")
    if not sent: return ["no POST /reservations sent"]
    u = tid(page, "booking-uncertain")
    if not u.count() or not u.first.is_visible() or not u.first.inner_text().strip(): errs.append("%s: booking-uncertain not shown with text" % cell)
    if tid(page, "booking-error").count() and tid(page, "booking-error").first.is_visible(): errs.append("%s: booking-error shown for a lost response" % cell)
    if tid(page, "confirmation").count() and tid(page, "confirmation").first.is_visible(): errs.append("%s: confirmation shown for a lost response" % cell)
    retry = []
    page.on("request", lambda q: retry.append((q.headers.get("idempotency-key"), q.post_data)) if q.method == "POST" and q.url.endswith("/reservations") else None)
    tid(page, "booking-submit").click()
    tid(page, "confirmation").wait_for(timeout=5000)
    if not retry or retry[0][0] != sent[0][0]: errs.append("%s: retry key %r != first key %r" % (cell, retry and retry[0][0], sent[0][0]))
    elif json.loads(retry[0][1]) != json.loads(sent[0][1]): errs.append("%s: retry body differs" % cell)
    ref = tid(page, "confirmation-reference").inner_text()
    if ref != sent[0][2].get("reference"): errs.append("%s: confirmation-reference %r, original %r" % (cell, ref, sent[0][2].get("reference")))
    for t in ("booking-uncertain", "booking-error"):
        if tid(page, t).count() and tid(page, t).first.is_visible(): errs.append("%s: %s still visible after successful retry" % (cell, t))
    return errs

def check():
    with server() as (base, api), browser() as page:
        login(page, base)
        errs = one(page, base, api, "slot-t_3-19:00", 2) + one(page, base, api, "slot-t_1+t_2-21:00", 5)
        tok = api.token()
        n = len(api.call("GET", "/reservations", headers={"authorization": "Bearer " + tok})[1]["reservations"])
        if n != 2: errs.append("server holds %d bookings, want 2 (one per attempt)" % n)
        return "; ".join(errs) or True

report("ui-uncertain-retry", "If a booking response is lost, including after the booking commits, show nonempty `booking-uncertain` text, without `booking-error` or a new confirmation. The unchanged form must retry with the same idempotency key and body.", check)
