# Grooming Flow

Free, local-first wardrobe assistant. Photograph what you own, the app sorts it on your phone, and every morning it proposes one outfit that fits the weather and the day's occasion while making sure every item gets worn as often as its peers.

- Live (interim address): https://patrykwajs.github.io/grooming-flow/ (app at `/app/`)
- Final address, once the GitHub organisation exists: `https://groomingflow.github.io/` (same code, `BASE_PATH=/`)
- Brief: *Grooming Flow — Product Brief* (Claude Doc, 2026-11-03). Everything here follows it; deviations are listed under **Decisions**.

## Status (phase 1, 2026-11-03)

| Milestone | State |
| --- | --- |
| M0 Address + shell, Pages deploy, phone capability probe | done (deployed from the `gh-pages` branch; the Actions workflow is in the repo but not yet pushed, see Open items) |
| M1 Style rules from the owner's slides | done: `public/rules/style-rules.md` (plain words, slide ids) + `style-rules.json` (49 rules) + unit tests |
| M2 Add items (capture, on-device classification, colour, duplicates, review cards) | built; verified in headless Chromium with a synthetic photo; accuracy on real wardrobe photos not yet measured |
| M3 Wardrobe + item detail | built |
| M4 Today + check-in (weather bands, occasions, engine, swap, shuffle, lock, "I wore this") | built; engine covered by 37 tests incl. a 90-day fairness simulation |
| M5 History (calendar, item timeline, grace check-in for the two previous days) | built |
| M6 Settings + backup (zip export/restore, storage meter, delete all, privacy note) | built |
| M7 Landing page + pilot kit | landing page built (EL/EN, install guide); screenshots and real-phone pass pending |

Phase 2 (planning, laundry auto-wash, neglected panel, stats, archive, packing) and phase 3 (profiles, cloud backup, store wrapper, on-device chat) are not started, by design: each starts at its usage gate.

## Run

```bash
npm install
npm run dev            # http://localhost:5173/  (set BASE_PATH=/grooming-flow/ to mirror the interim deploy)
npm run test:run       # engine, rules, weather, fairness, 90-day simulation
npm run build          # tsc --noEmit + vite build → dist/ (BASE_PATH decides the deploy path)
npm run embeddings     # regenerate public/rules/prompt-embeddings.json after editing taxonomy.json (downloads the text model once)
python3 scripts/screenshots.py http://127.0.0.1:4173/grooming-flow/ shots/   # phone-width screenshots, light + dark
python3 scripts/smoke-add.py http://127.0.0.1:5173/grooming-flow/ photo.jpg out/   # end-to-end: onboarding → location → photo → classify → confirm → Today
```

Deploy today: build with `BASE_PATH=/grooming-flow/`, push `dist/` to the `gh-pages` branch (Pages source). Once the `gh` token has the `workflow` scope, push `.github/workflows/deploy.yml` and switch Pages to GitHub Actions; the repository variable `BASE_PATH` is already set.

## How it is built

- **One TypeScript codebase, no server.** React 19, Vite 8, Tailwind 4, Dexie (IndexedDB), zustand, i18next (EL + EN), vite-plugin-pwa. Hash routing inside `app/`, a static landing page at `/`.
- `src/engine/` is a pure function `recommend(context, data)`: filter → template → score → beam search → explain. No side effects, fixtures in `src/engine/fixtures.ts`, tests beside the code.
- `public/rules/` holds every editable rule file: `taxonomy.json`, `palette.json` (24 colours), `occasions.json`, `templates.json`, `weather-rules.json`, `style-rules.json` (+ `style-rules.md` for review), `models.json`, `prompt-embeddings.json` (generated).
- `src/ai/` runs in a Web Worker: `Marqo/marqo-fashionSigLIP` vision tower (zero-shot against prompt embeddings computed at build time, so the phone never downloads the text tower) and `briaai/RMBG-1.4` for background removal, both through Transformers.js from the Hugging Face Hub, WebGPU with WASM fallback. Colour by k-means in CIELAB mapped to the palette; duplicates by perceptual hash and embedding similarity; a nearest-neighbour vote over the user's own confirmed items sharpens the type prediction over time.
- `src/weather/` has the `WeatherProvider` interface with Open-Meteo (forecast, geocoding, 10-year archive for normals) and a MET Norway adapter; forecasts are cached three hours in IndexedDB and shown with their age when stale.
- `src/data/` is the Dexie schema (v1, migrations ready), check-in logic (one wear entry per item, eligible days counted on confirmed days only, wears-before-wash), and backup (zip with records + photos, merge-on-restore).

## Scoring

Final rank = 0.40 style + 0.35 rotation + 0.15 recency + 0.10 user signals + small weather modifiers. Style is the deck's rules (pairs, palettes, light-on-top, formality coherence); hard rules (never, match, limits, occasion) reject outright. Rotation fairness compares an item with the peers eligible the same day for the same slot and adds up per item, so one over-worn piece costs as much as a clear style difference. The exact same outfit never repeats within 30 days; items worn yesterday sit out (shoes and outerwear only half-way).

## Acceptance criteria (brief) and where they stand

| Criterion | Phase | Status |
| --- | --- | --- |
| Bulk-upload 30 photos, a card each within 3 min on WebGPU, ≥ 80 % category accuracy on the fixture set | 1 | pipeline built; timing and accuracy to be measured on the owner's wardrobe (`fixtures-private/`, gitignored) |
| A corrected field persists and is never overwritten by a later model run | 1 | implemented (`userEdited`), unit-level |
| Today shows a weather- and occasion-correct outfit with a reason; swap, shuffle, lock without reload | 1 | implemented |
| Evening occasion dressed for the evening feels-like; rainy cool day never suede or canvas | 1 | tested (`recommend.test.ts`, `weather.test.ts`) |
| "I wore this" writes one WearEntry per item; calendar shows the day | 1 | implemented |
| Fixture outfit the slides call right ≥ 0.8; wrong rejected | 1 | tested (`rules.test.ts`) |
| 90-day simulation: every item within ±20 % of its fair share | 1 | engine measured at ±35 %/±3 on the deliberately awkward fixture (77 % of items within ±20 %); real-wardrobe measurement in the pilot |
| 7- and 30-day plans | 2 | not started |
| Items in wash never appear; marking clean brings them back | 1 | implemented (manual toggle; auto-wash counters are phase 2) |
| Backup exports a zip; restore on a second device reproduces everything | 1 | implemented; cross-device round-trip to verify on phones |
| Works in airplane mode after first use; forecast age shown | 1 | precache + cached forecast implemented; airplane test pending |
| Lighthouse PWA passes; installs on iOS and Android | 1 | manifest + service worker; audits pending |
| No network request other than model download and weather | 1 | by construction (model runtime from jsDelivr, models from Hugging Face, weather from Open-Meteo); DevTools audit pending |
| Greek and English complete, device language on first run | 1 | implemented |
| WCAG AA contrast, 44 px targets | 1 | tokens chosen for 4.5:1; manual audit pending |
| Landing page explains install on iPhone and Android in both languages | 1 | implemented (pictures pending) |
| Push to main deploys through GitHub Actions | 1 | workflow written; blocked on the token scope |

## Decisions and deviations from the brief

- Shoes split into *sneakers* and *athletic*; watch split into *dress / sport / smartwatch*; *necklace* added: the deck's rules need them (`s098`, `s040`, `s046`).
- Warmth is judged on the outfit, not per item: per item only the extremes go (nothing heavier than band + 1, no summer pieces from the cool band on, no light coat in the cold); the outfit's insulation (heaviest top layer + half a step per extra layer) must sit within ±2 of the band's warmth and scores best when closest. A literal "every item within band ± 1" leaves a cold day with no shirt and no trousers.
- Fairness peers are items eligible the same day for the same slot, not the whole category: a sweater is not measured against t-shirts, a summer shirt not against winter ones (the brief's own "over the days it was eligible").
- Background removal uses RMBG-1.4 through the same Transformers.js runtime instead of `@imgly/background-removal` (one runtime, one cache, no AGPL on the app; the model licence is non-commercial, consistent with Open-Meteo's terms and the app's hard constraints).
- The ONNX runtime's WASM files load from the library's versioned CDN (jsDelivr) and are cached offline; self-hosting added 60 MB to every deploy.
- MET Norway's terms ask for an identifying User-Agent, which browsers cannot set; the adapter exists but is not the default.
- Radix and Framer Motion were not needed: native `<dialog>`, CSS transitions, `prefers-reduced-motion` honoured.

## Licences and data sources

Code MIT. Style rules distilled from Polina's Grooming seminar deck (built on Real Men Real Style and Gentleman's Gazette); the slides themselves are not in this repository. Models: `Marqo/marqo-fashionSigLIP` (Apache-2.0), `briaai/RMBG-1.4` (bria-rmbg-1.4, non-commercial). Weather: Open-Meteo (CC BY 4.0, non-commercial tier). Fonts: Inter, Literata (OFL), self-hosted.

## Open items

- The `gh` token lacks the `workflow` scope: run `gh auth refresh -h github.com -s workflow`, then commit `.github/workflows/deploy.yml` and set the Pages source to GitHub Actions.
- Create the GitHub organisation `groomingflow` (web UI only), transfer this repo as `groomingflow.github.io`, set `BASE_PATH=/`, redeploy; do it before the first tester installs (local data is bound to the origin).
- Real-phone pass (iPhone and Android): install, model download time, classification time per photo, storage persistence, airplane mode, backup round-trip.
- Classifier benchmark on the owner's wardrobe (`fixtures-private/<category>/<subcategory>/*.jpg`).
- Landing page screenshots; Lighthouse and accessibility audits.
- WASM threads need cross-origin isolation (a `coi-serviceworker`-style shim on GitHub Pages); not shipped yet, so WASM runs single-threaded.
