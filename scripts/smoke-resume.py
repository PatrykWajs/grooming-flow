# -*- coding: utf-8 -*-
"""Reload-survival test for the Add screen in headless Chromium: pick photos,
reload the page while they are still queued (before the models are even
downloaded), check the cards come back, let the pipeline finish, confirm,
check the wardrobe. Then reload once more with a confirmed batch and check
nothing is restored twice.

Usage: python3 scripts/smoke-resume.py BASE_URL IMAGE_DIR OUT_DIR
IMAGE_DIR holds the photos to pick (every *.png / *.jpg in it).
"""
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip("/") + "/"
images = sorted(p for p in pathlib.Path(sys.argv[2]).iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
out = pathlib.Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)


def shot(page, name):
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / f"{name}.png"))
    print("saved", name, flush=True)


def body(page):
    return page.locator("body").inner_text()


def cards(page):
    """Review cards only (the bottom navigation is a list too)."""
    return page.locator("ul.flex-col > li").count()


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="en-GB", is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {getattr(e, 'message', e)}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text[:300]}") if m.type == "error" else None)

    page.goto(base + "app/#/onboarding", wait_until="networkidle")
    page.wait_for_timeout(800)
    for text in ["I'll do it later", "Next", "Start"]:
        page.get_by_role("button", name=text).first.click()
        page.wait_for_timeout(300)

    page.goto(base + "app/#/add")
    page.wait_for_timeout(1500)
    page.locator("input[type=file][multiple]").set_input_files([str(i) for i in images])
    page.wait_for_timeout(1500)
    cards_before = cards(page)
    print("cards after picking:", cards_before, flush=True)
    shot(page, "resume-1-picked")

    # The reload the owner saw: mid-batch, nothing confirmed yet. (Not
    # "networkidle": the restored queue restarts the model download at once.)
    page.reload(wait_until="load")
    page.wait_for_timeout(3000)
    text = body(page)
    cards_after = cards(page)
    print("cards after reload:", cards_after, "| resumed toast:", "Resumed" in text, flush=True)
    shot(page, "resume-2-after-reload")
    assert cards_after == cards_before, f"expected {cards_before} cards after reload, got {cards_after}"

    # Let the pipeline run (model download on first use), then confirm everything.
    started = time.time()
    while time.time() < started + 900:
        text = body(page)
        # "Processing n of m" turns into "Check the names, then add" once the last card is done.
        if "Processing" not in text and ("Check the names" in text or "Add all" in text):
            break
        time.sleep(5)
    print(f"pipeline took {int(time.time() - started)}s", flush=True)
    shot(page, "resume-3-ready")
    ready = page.get_by_role("button", name="Add", exact=True).count()
    print("ready cards:", ready, flush=True)
    confirm_all = page.get_by_role("button", name="Add all", exact=True)
    if confirm_all.count():
        confirm_all.first.click()
        page.wait_for_timeout(1500)
    shot(page, "resume-4-confirmed")

    # A confirmed batch is not restored again.
    page.reload(wait_until="load")
    page.wait_for_timeout(2500)
    print("cards after second reload:", cards(page), "| resumed toast:", "Resumed" in body(page), flush=True)

    page.goto(base + "app/#/wardrobe")
    page.wait_for_timeout(1500)
    print("WARDROBE:", body(page)[:160].replace("\n", " | "), flush=True)
    shot(page, "resume-5-wardrobe")
    print(f"errors: {len(errors)}")
    for e in errors[:20]:
        print("  ", e)
    context.close()
    browser.close()
