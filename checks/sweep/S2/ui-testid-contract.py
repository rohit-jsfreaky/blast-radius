from ui_lib import *

# F13: presence-only-when error elements, exact texts, current-user on every screen, pair cell ids,
# data-available equals API membership, tables named in summary/confirmation/lookup.
def visible(page, t): return tid(page, t).count() > 0 and tid(page, t).first.is_visible()

def check():
    errs = []
    with server() as (base, api), browser() as page:
        page.goto(base + "/login"); page.wait_for_timeout(300)
        if tid(page, "auth-error").count(): errs.append("auth-error present with no error on /login")
        tid(page, "login-email").fill("ada@example.com"); tid(page, "login-password").fill("wrong pass"); tid(page, "login-submit").click()
        tid(page, "auth-error").wait_for(timeout=3000)
        tid(page, "login-password").fill("correct horse"); tid(page, "login-submit").click()
        tid(page, "current-user").wait_for(timeout=5000)
        if tid(page, "auth-error").count(): errs.append("auth-error still present after successful login")
        for route in ("/", "/signup", "/login", "/lookup"):
            page.goto(base + route); page.wait_for_timeout(300)
            if not visible(page, "current-user") or "Ada Lovelace" not in tid(page, "current-user").inner_text(): errs.append("current-user missing on %s" % route)
            if not tid(page, "logout-button").count(): errs.append("logout-button missing on %s" % route)
        page.goto(base + "/"); search(page, 3)
        st, av = api.call("GET", "/availability?restaurant_id=r_anker&date=%s&party_size=3" % DATE)
        for s in av["slots"]:
            hm = s["starts_at_local"][11:]
            for t in ("t_1", "t_2", "t_3"):
                c = tid(page, "slot-%s-%s" % (t, hm))
                want = "true" if t in s["available_table_ids"] else "false"
                if c.count() != 1: errs.append("cell slot-%s-%s count %d" % (t, hm, c.count())); break
                if c.get_attribute("data-available") != want: errs.append("slot-%s-%s data-available %s want %s" % (t, hm, c.get_attribute("data-available"), want))
            for o in s["available_options"]:
                if len(o["table_ids"]) == 2:
                    c = tid(page, "slot-%s+%s-%s" % (o["table_ids"][0], o["table_ids"][1], hm))
                    if c.count() != 1 or c.get_attribute("data-available") != "true": errs.append("pair cell slot-%s+%s-%s missing/unavailable" % (o["table_ids"][0], o["table_ids"][1], hm))
        if tid(page, "slot-t_2+t_1-19:00").count(): errs.append("pair cell id not in combinable order")
        if tid(page, "slot-t_1+t_3-19:00").count(): errs.append("non-declared pair cell shown")
        tid(page, "slot-t_2+t_3-19:00").click(); tid(page, "booking-form").wait_for(timeout=3000)
        summ = tid(page, "booking-summary").inner_text()
        if "Booth" not in summ or "Garden" not in summ or "19:00" not in summ: errs.append("booking-summary %r lacks both labels/time" % summ)
        if tid(page, "booking-party-size").input_value() != "3": errs.append("booking-party-size not pre-filled from search")
        if tid(page, "booking-error").count() and visible(page, "booking-error"): errs.append("booking-error visible before any failure")
        tid(page, "booking-submit").click(); tid(page, "confirmation").wait_for(timeout=5000)
        ref = tid(page, "confirmation-reference").inner_text()
        if not __import__("re").fullmatch(r"[A-Z0-9]{6,12}", ref): errs.append("confirmation-reference text %r is not exactly the reference" % ref)
        ct = tid(page, "confirmation-tables").inner_text() if tid(page, "confirmation-tables").count() else ""
        if "Booth" not in ct or "Garden" not in ct: errs.append("confirmation-tables %r" % ct)
        cd = tid(page, "confirmation-details").inner_text()
        if "Zum Anker" not in cd or "19:00" not in cd: errs.append("confirmation-details %r" % cd)
        # resubmit unchanged: same reference, no booking-error, no second booking
        tid(page, "booking-submit").click(); page.wait_for_timeout(1200)
        if tid(page, "confirmation-reference").inner_text() != ref: errs.append("unchanged resubmit gave another reference")
        if visible(page, "booking-error"): errs.append("unchanged resubmit shows booking-error")
        # lookup
        page.goto(base + "/lookup"); page.wait_for_timeout(300)
        if tid(page, "reservation-error").count() and visible(page, "reservation-error"): errs.append("reservation-error visible before any lookup")
        tid(page, "lookup-reference-input").fill("NOPE99"); tid(page, "lookup-submit").click(); tid(page, "reservation-error").wait_for(timeout=3000)
        tid(page, "lookup-reference-input").fill(ref); tid(page, "lookup-submit").click(); tid(page, "reservation-detail").wait_for(timeout=3000)
        if visible(page, "reservation-error"): errs.append("reservation-error still visible after a found lookup")
        if tid(page, "reservation-status").inner_text() != "confirmed": errs.append("reservation-status %r" % tid(page, "reservation-status").inner_text())
        rt = tid(page, "reservation-tables").inner_text() if tid(page, "reservation-tables").count() else ""
        if "Booth" not in rt or "Garden" not in rt: errs.append("reservation-tables %r" % rt)
        tid(page, "reservation-cancel-button").click(); page.wait_for_timeout(1000)
        if tid(page, "reservation-status").inner_text() != "cancelled": errs.append("status after cancel %r" % tid(page, "reservation-status").inner_text())
        if tid(page, "reservation-cancel-button").count(): errs.append("reservation-cancel-button present once cancelled")
        page.click('[data-testid="logout-button"]'); page.wait_for_timeout(500)
        if tid(page, "current-user").count(): errs.append("current-user present after logout")
    return "; ".join(errs) or True

report("ui-testid-contract", "`auth-error` | Error message. Present only when there is one", check)
