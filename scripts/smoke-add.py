# -*- coding: utf-8 -*-
"""End-to-end smoke test in headless Chromium: onboarding, a real location,
one photo through the on-device pipeline (model download, background removal,
classification), confirm, wardrobe, Today.

Usage: python3 scripts/smoke-add.py BASE_URL IMAGE_PATH OUT_DIR
"""
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip("/") + "/"
image = sys.argv[2]
out = pathlib.Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)


def shot(page, name):
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / f"{name}.png"))
    print("saved", name, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="en-GB", is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {getattr(e, 'name', '')} {getattr(e, 'message', '')}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text[:300]}") if m.type in ("error", "warning") else None)

    page.goto(base + "app/#/onboarding", wait_until="networkidle")
    page.wait_for_timeout(800)
    for text in ["I'll do it later", "Next", "Next", "Start"]:
        page.get_by_role("button", name=text).first.click()
        page.wait_for_timeout(400)

    page.goto(base + "app/#/settings")
    page.wait_for_timeout(800)
    page.get_by_label("Search a city").fill("Athens")
    page.wait_for_timeout(2500)
    results = page.locator("button", has_text="Athens")
    print("geocoding results:", results.count(), flush=True)
    if results.count():
        results.first.click()
        page.wait_for_timeout(800)
    shot(page, "smoke-settings")

    page.goto(base + "app/#/add")
    page.wait_for_timeout(1500)
    page.locator("input[type=file][multiple]").set_input_files(image)
    started = time.time()
    deadline = started + 900
    last = ""
    while time.time() < deadline:
        text = page.locator("body").inner_text()
        if "Confirm" in text and "%" in text:
            break
        if "Could not process" in text or "could not be read" in text:
            break
        status = [line for line in text.splitlines() if "Downloading" in line or "Processing" in line]
        if status and status[0] != last:
            last = status[0]
            print(f"{int(time.time() - started)}s {last}", flush=True)
        time.sleep(5)
    print(f"pipeline took {int(time.time() - started)}s", flush=True)
    card = page.locator("ul li").first.inner_text() if page.locator("ul li").count() else page.locator("body").inner_text()
    print("CARD:", card[:600].replace("\n", " | "), flush=True)
    shot(page, "smoke-add")
    confirm = page.get_by_role("button", name="Confirm", exact=True)
    if confirm.count():
        confirm.first.click()
        page.wait_for_timeout(1000)
    page.goto(base + "app/#/wardrobe")
    page.wait_for_timeout(1500)
    shot(page, "smoke-wardrobe")
    page.goto(base + "app/#/today")
    page.wait_for_timeout(3000)
    shot(page, "smoke-today")
    print("TODAY:", page.locator("body").inner_text()[:500].replace("\n", " | "), flush=True)
    print(f"errors: {len(errors)}")
    for e in errors[:25]:
        print("  ", e)
    context.close()
    browser.close()
