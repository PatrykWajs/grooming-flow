# -*- coding: utf-8 -*-
"""Phone-width screenshots of the built app for visual verification.

Usage: python3 scripts/screenshots.py http://localhost:4173/grooming-flow/ OUT_DIR
Takes the landing page and onboarding, walks the onboarding through its own
buttons, then Today, Wardrobe, Add, History, Settings, in light and dark at
390x844 (iPhone 14-ish). Prints every page error and console error.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip("/") + "/"
out = pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

NEXT = {"el": ["Αργότερα", "Επόμενο", "Επόμενο", "Ξεκίνα"], "en": ["I'll do it later", "Next", "Next", "Start"]}


def shot(page, name):
    page.wait_for_timeout(700)
    page.screenshot(path=str(out / f"{name}.png"), full_page=False)
    print("saved", name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for scheme, locale, lang in (("light", "el-GR", "el"), ("dark", "en-GB", "en")):
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme=scheme, locale=locale, is_mobile=True, has_touch=True)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {getattr(e, 'name', '')} {getattr(e, 'message', '')} {str(getattr(e, 'stack', ''))[:400]}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("response", lambda r: errors.append(f"http {r.status}: {r.url}") if r.status >= 400 else None)
        page.goto(base, wait_until="networkidle")
        shot(page, f"landing-{scheme}")
        page.goto(base + "app/#/onboarding", wait_until="networkidle")
        page.wait_for_timeout(800)
        shot(page, f"onboarding-{scheme}")
        for text in NEXT[lang]:
            button = page.get_by_role("button", name=text)
            if button.count() == 0:
                print("button not found:", text)
                break
            button.first.click()
            page.wait_for_timeout(400)
        for route in ("today", "wardrobe", "add", "history", "settings"):
            page.goto(base + f"app/#/{route}")
            page.wait_for_timeout(1500)
            shot(page, f"{route}-{scheme}")
        print(f"[{scheme}] errors: {len(errors)}")
        for e in errors[:15]:
            print("  ", e[:300])
        context.close()
    browser.close()
