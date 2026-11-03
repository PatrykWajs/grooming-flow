# -*- coding: utf-8 -*-
"""Visual tour of the day model with a fixture wardrobe restored through the
app's own backup: default moment, a second outfit, "right now", a check-in,
plan ahead, a future day, history. Light/Greek and dark/English, 390x844.

Usage: python3 scripts/tour.py BASE_URL FIXTURE_BACKUP.zip OUT_DIR
(make the zip with scripts/make-fixture-backup.py)
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip("/") + "/"
backup = sys.argv[2]
out = pathlib.Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)

T = {
    "el": {"next": ["Αργότερα", "Επόμενο", "Επόμενο", "Ξεκίνα"], "restore": "Επαναφορά αντιγράφου", "another": "Άλλο ένα σύνολο", "now": "Για τώρα", "save": "Αποθήκευση", "evening": "Βραδινή έξοδος", "wear": "Το φόρεσα", "plan": "Πλάνο", "days3": "3 ημέρες", "go": "Πλάνο για 3 μέρες"},
    "en": {"next": ["I'll do it later", "Next", "Next", "Start"], "restore": "Restore a backup", "another": "Another outfit", "now": "Right now", "save": "Save", "evening": "Evening out", "wear": "I wore this", "plan": "Plan", "days3": "3 days", "go": "Plan 3 days"},
}


def shot(page, name):
    page.wait_for_timeout(900)
    page.screenshot(path=str(out / f"{name}.png"), full_page=False)
    print("saved", name, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for scheme, locale, lang in (("light", "el-GR", "el"), ("dark", "en-GB", "en")):
        s = T[lang]
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme=scheme, locale=locale, is_mobile=True, has_touch=True)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {getattr(e, 'message', e)}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text[:200]}") if m.type == "error" else None)
        page.on("response", lambda r: errors.append(f"http {r.status}: {r.url}") if r.status >= 400 else None)
        page.on("dialog", lambda d: d.accept())

        page.goto(base + "app/#/onboarding", wait_until="networkidle")
        page.wait_for_timeout(600)
        for text in s["next"]:
            page.get_by_role("button", name=text).first.click()
            page.wait_for_timeout(300)

        # Restore the fixture wardrobe (location included) through Settings.
        page.goto(base + "app/#/settings")
        page.wait_for_timeout(800)
        page.locator("input[type=file][accept*=zip]").set_input_files(backup)
        page.wait_for_timeout(1500)

        page.goto(base + "app/#/today")
        page.wait_for_timeout(3500)
        shot(page, f"1-today-default-{scheme}")

        # A second outfit for the evening.
        page.get_by_role("button", name=s["another"]).first.click()
        page.wait_for_timeout(500)
        shot(page, f"2-editor-{scheme}")
        page.get_by_role("button", name=s["evening"], exact=True).last.click()
        page.wait_for_timeout(200)
        page.get_by_role("button", name=s["save"], exact=True).click()
        page.wait_for_timeout(3000)
        shot(page, f"3-today-two-{scheme}")

        # Right now.
        page.get_by_role("button", name=s["now"], exact=True).first.click()
        page.wait_for_timeout(400)
        page.get_by_role("button", name=s["save"], exact=True).click()
        page.wait_for_timeout(3000)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        shot(page, f"4-today-now-{scheme}")

        # Log the first outfit of the day.
        page.evaluate("window.scrollTo(0, 0)")
        page.get_by_role("button", name=s["wear"], exact=True).first.click()
        page.wait_for_timeout(3000)
        shot(page, f"5-today-logged-{scheme}")

        # Plan three days ahead, then look at tomorrow.
        page.get_by_role("button", name=s["plan"], exact=True).first.click()
        page.wait_for_timeout(500)
        shot(page, f"6-plan-sheet-{scheme}")
        page.get_by_role("button", name=s["days3"], exact=True).click()
        page.get_by_role("button", name=s["go"], exact=True).click()
        page.wait_for_timeout(5000)
        shot(page, f"7-today-planned-{scheme}")
        tabs = page.get_by_role("tab")
        tabs.nth(3).click()  # two grace days, today, tomorrow
        page.wait_for_timeout(3000)
        shot(page, f"8-tomorrow-{scheme}")

        page.goto(base + "app/#/history")
        page.wait_for_timeout(1500)
        shot(page, f"9-history-{scheme}")
        print("TODAY TEXT:", page.locator("body").inner_text()[:200].replace("\n", " | "), flush=True)
        print(f"[{scheme}] errors: {len(errors)}")
        for e in errors[:15]:
            print("  ", e[:300])
        context.close()
    browser.close()
