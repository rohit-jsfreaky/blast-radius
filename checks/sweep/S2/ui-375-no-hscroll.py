from ui_lib import *

def check():
    with server() as (base, api), browser(375) as page:
        errs = []
        over = lambda: page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        for route in ("/", "/signup", "/login", "/lookup"):
            page.goto(base + route); page.wait_for_timeout(300)
            if over(): errs.append("%s scrolls sideways" % route)
        login(page, base)
        page.goto(base + "/"); search(page, 3)
        if over(): errs.append("/ with grid (pair cells) scrolls sideways")
        tid(page, "slot-t_2-19:00").click(); tid(page, "booking-form").wait_for(timeout=3000)
        if over(): errs.append("/ with booking form scrolls sideways")
        tid(page, "booking-submit").click(); tid(page, "confirmation").wait_for(timeout=5000)
        if over(): errs.append("/ with confirmation scrolls sideways")
        ref = tid(page, "confirmation-reference").inner_text().strip()
        page.goto(base + "/lookup"); tid(page, "lookup-reference-input").fill(ref); tid(page, "lookup-submit").click()
        tid(page, "reservation-detail").wait_for(timeout=5000)
        if over(): errs.append("/lookup with detail scrolls sideways")
        return "; ".join(errs) or True

report("ui-375-no-hscroll", "The required flows must remain clear and usable at a 375 CSS-pixel viewport and at conventional desktop widths, without horizontal page scrolling.", check)
