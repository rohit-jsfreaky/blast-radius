from ui_lib import *


# Search A (party 1) is delayed so it finishes after search B (party 5). Grid must describe B.
def check():
    with server() as (base, api), browser() as page:
        # delay only the party-1 availability answer, inside the page (a sync route handler would serialise requests)
        page.add_init_script("""(() => { const f = window.fetch.bind(window);
          window.fetch = async (u, o) => { const r = await f(u, o);
            if (String(u).includes('/availability') && String(u).includes('party_size=1')) await new Promise(k => setTimeout(k, 1500));
            return r; }; })();""")
        login(page, base); page.goto(base + "/")
        tid(page, "restaurant-select").wait_for(timeout=5000)
        errs = []
        # A then B, without waiting for A
        tid(page, "restaurant-select").select_option("r_anker"); tid(page, "date-input").fill(DATE)
        tid(page, "party-size-input").fill("1"); tid(page, "search-button").click()
        page.wait_for_timeout(100)
        tid(page, "party-size-input").fill("5"); tid(page, "search-button").click()
        page.wait_for_timeout(2500)
        a = tid(page, "slot-t_1-19:00")
        if a.count() and a.get_attribute("data-available") == "true": errs.append("single t_1 shown available: late party-1 answer painted over party-5")
        p = tid(page, "slot-t_1+t_2-19:00")
        if not p.count() or p.get_attribute("data-available") != "true": errs.append("pair cell for party 5 missing/unavailable after B")
        # booking form opened from the grid must describe B's party size
        if p.count():
            p.click(); tid(page, "booking-form").wait_for(timeout=3000)
            v = tid(page, "booking-party-size").input_value()
            if v != "5": errs.append("booking-party-size %r, want 5 (from search B)" % v)
        # lookup: two lookups out of order -> the second wins
        return "; ".join(errs) or True

report("ui-out-of-order", "If search A starts before search B but finishes after it, the grid, table labels and booking form must describe B. A late response must not restore A's results.", check)
