from ui_lib import *

# Another client takes the table after the form opens: booking-error, availability refreshed,
# form and inputs preserved, no confirmation. Single and pair.
def one(page, base, api, cell, party, other_body):
    errs = []
    page.goto(base + "/"); search(page, party)
    tid(page, cell).click(); tid(page, "booking-form").wait_for(timeout=3000)
    tid(page, "booking-party-size").fill(str(party))
    bob = api.token("bob@example.com")
    s, b = api.call("POST", "/reservations", other_body, {"authorization": "Bearer " + bob, "idempotency-key": "bob-" + cell})
    if s != 201: return ["setup: bob booking %s %s" % (s, b)]
    tid(page, "booking-submit").click()
    tid(page, "booking-error").wait_for(timeout=5000)
    if tid(page, "confirmation").count() and tid(page, "confirmation").first.is_visible(): errs.append("%s: confirmation shown after 409" % cell)
    if not tid(page, "booking-form").count() or not tid(page, "booking-form").first.is_visible(): errs.append("%s: booking form not preserved" % cell)
    elif tid(page, "booking-party-size").input_value() != str(party): errs.append("%s: party size input not preserved" % cell)
    page.wait_for_timeout(800)
    c = tid(page, cell)
    if c.count() and c.get_attribute("data-available") != "false": errs.append("%s: availability not refreshed (cell still available)" % cell)
    return errs

def check():
    with server() as (base, api), browser() as page:
        login(page, base)
        errs = one(page, base, api, "slot-t_3-19:00", 2, {"restaurant_id": "r_anker", "table_id": "t_3", "starts_at_local": DATE + "T19:00", "party_size": 2})
        errs += one(page, base, api, "slot-t_1+t_2-21:00", 5, {"restaurant_id": "r_anker", "table_id": "t_1", "starts_at_local": DATE + "T21:00", "party_size": 1})
        return "; ".join(errs) or True

report("ui-409-preserve", "If another client takes a table after the form opens, a `409 table_unavailable` response shows `booking-error` and refreshes availability. Preserve the selected form and its inputs", check)
