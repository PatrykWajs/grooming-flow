# Grooming Flow

Free, local-first wardrobe assistant. Add your clothes, say where you're going, get the outfit. The app names each photographed item on your phone, and every combination follows the rules of the Grooming seminar and the weather over the hours you will be out, while every item gets worn as often as its peers. A second outfit for the evening, the next days planned ahead, yesterday logged late: all from the same screen.

- Live (interim address): https://patrykwajs.github.io/grooming-flow/ (app at `/app/`)
- Final address, once the GitHub organisation exists: `https://groomingflow.github.io/` (same code, `BASE_PATH=/`)
- Brief: *Grooming Flow — Product Brief* (Claude Doc, 2026-11-03). Everything here follows it; deviations are listed under **Decisions**.

## Status (phase 1, 2026-11-03)

| Milestone | State |
| --- | --- |
| M0 Address + shell, Pages deploy, phone capability probe | done (deployed from the `gh-pages` branch; the Actions workflow is in the repo but not yet pushed, see Open items) |
| M1 Style rules from the owner's slides | done: `public/rules/style-rules.md` (plain words, slide ids) + `style-rules.json` (49 rules) + unit tests |
| M2 Add clothes (capture, on-device classification, colour, duplicates, review cards) | built; a card is the cutout on white plus its name; *Change* opens type and colour, nothing else to fill in. Reload-safe since 2026-11-03: the batch is kept on disk and resumes (`smoke-resume.py`) |
| M3 Wardrobe + item page | built (photo on white, in the wash, worn count, change type or colour, delete) |
| M4 Today + check-in (weather bands, occasions, engine, swap, another one, "I'll wear this") | built; engine covered by 52 tests incl. a 90-day fairness simulation |
| M4b Several outfits per day, plan 1–14 days ahead | built; "Going somewhere else later?" adds the second outfit, the plan sheet fills the next days (see **How you use it**) |
| M5 History (calendar with every outfit of a day, late check-in for yesterday) | built |
| M6 Settings + backup (location, language, zip export/restore, delete all, privacy note) | built |
| M7 Landing page + pilot kit | landing page built (EL/EN, how it works, install guide); screenshots and real-phone pass pending |
| M8 Simple mode (0.2, 2026-11-03, owner's request): nothing to configure, white backgrounds | built; see **Decisions** |

Of phase 2, planning was pulled forward on the owner's request; laundry auto-wash, the neglected panel, stats, the archive and packing lists, and phase 3 (profiles, cloud backup, store wrapper, on-device chat) are not started, by design: each starts at its usage gate.

## How you use it

1. **Add clothes.** One photo per item. The app removes the background, lays the item on white, names it ("light blue t-shirt") and shows a card. Tap *Add*, or *Change* when the type or the colour is wrong. Warmth, formality and seasons follow from the type; there is nothing else to fill in.
2. **Say where you're going.** Today shows the occasions as buttons: office, smart, casual, home, gym, evening out, bar, date, formal event, travel. Tap one.
3. **Get the outfit.** It appears with its reason (the weather over those hours, what has not been worn for a while). *I'll wear this* logs it; *Another one* shows the next combination; tapping a piece swaps just that piece.

- **Going somewhere else later?** The same buttons under the outfit add a second outfit to the day, dressed for its own hours and weather. Counters move once per day: trousers worn in two outfits count one wear.
- **Plan** (top right) fills the next 1, 2, 3, 5, 7 or 14 days with one occasion, each outfit chosen with the days before it taken as worn; days you already set keep their occasion; *clear the plan* removes what the planner made and nothing you logged. The planned days are listed under today.
- **Forgot yesterday?** A link under the buttons logs yesterday the same way.
- **In the wash** is the only switch on an item; *All clean* in the wardrobe brings everything back.

## Run

```bash
npm install
npm run dev            # http://localhost:5173/  (set BASE_PATH=/grooming-flow/ to mirror the interim deploy)
npm run test:run       # engine, rules, weather, fairness, 90-day simulation
npm run build          # tsc --noEmit + vite build → dist/ (BASE_PATH decides the deploy path)
npm run embeddings     # regenerate public/rules/prompt-embeddings.json after editing taxonomy.json (downloads the text model once)
python3 -I scripts/i18n-audit.py .   # every t('…') key in src/ exists in en.json; en and el have the same leaves (exit 1 otherwise)
python3 scripts/screenshots.py http://127.0.0.1:4173/grooming-flow/ shots/   # phone-width screenshots, light + dark (empty wardrobe)
python3 scripts/make-fixture-backup.py fixture.zip && python3 scripts/tour.py http://127.0.0.1:4173/grooming-flow/ fixture.zip tour/   # restores a labelled fixture wardrobe through Settings, walks the flow (where are you going, outfit, another one, wear it, evening, plan 3 days, coming days, wardrobe, item, add, settings, history), both themes
python3 scripts/smoke-add.py http://127.0.0.1:5173/grooming-flow/ photo.jpg out/   # end-to-end: onboarding → location → photo → classify → confirm → Today
python3 scripts/smoke-resume.py http://127.0.0.1:4173/grooming-flow/ photos/ out/   # reload survival: pick photos, reload mid-batch, cards come back, pipeline finishes, confirm
```

Deploy today: build with `BASE_PATH=/grooming-flow/`, push `dist/` to the `gh-pages` branch (Pages source). Once the `gh` token has the `workflow` scope, push `.github/workflows/deploy.yml` and switch Pages to GitHub Actions; the repository variable `BASE_PATH` is already set.

## How it is built

- **One TypeScript codebase, no server.** React 19, Vite 8, Tailwind 4, Dexie (IndexedDB), zustand, i18next (EL + EN), vite-plugin-pwa. Hash routing inside `app/`, a static landing page at `/`.
- `src/engine/` is a pure function `recommend(context, data)`: filter → template → score → beam search → explain. No side effects, fixtures in `src/engine/fixtures.ts`, tests beside the code.
- `public/rules/` holds every editable rule file: `taxonomy.json`, `palette.json` (24 colours), `occasions.json`, `templates.json`, `weather-rules.json`, `style-rules.json` (+ `style-rules.md` for review), `models.json`, `prompt-embeddings.json` (generated).
- `src/ai/` runs in a Web Worker: `Marqo/marqo-fashionSigLIP` vision tower (zero-shot against prompt embeddings computed at build time, so the phone never downloads the text tower) and `briaai/RMBG-1.4` for background removal, both through Transformers.js from the Hugging Face Hub, WebGPU with WASM fallback. The cutout is laid on white before it is classified, hashed, stored and shown; colour is read from the garment pixels alone (k-means in CIELAB mapped to the palette); duplicates by perceptual hash and embedding similarity; a nearest-neighbour vote over the user's own confirmed items sharpens the type prediction over time.
- `src/weather/` has the `WeatherProvider` interface with Open-Meteo (forecast, geocoding, 10-year archive for normals) and a MET Norway adapter; forecasts are cached three hours in IndexedDB and shown with their age when stale.
- `src/data/` is the Dexie schema (v3: `moments` replaced the v1 `dayPlans`, migrated on open), check-in logic (one wear entry per item per moment, counters once per day, eligible days counted on confirmed days only, wears-before-wash) with tests on `fake-indexeddb`, and backup (zip with records + photos, merge-on-restore; v1 backups still restore).
- `src/engine/plan.ts` is the pure multi-step planner: `planSequence` recommends moments in calendar order, feeding each chosen outfit into the next as worn.

## Scoring

Final rank = 0.40 style + 0.35 rotation + 0.15 recency + 0.10 user signals + small weather modifiers. Style is the deck's rules (pairs, palettes, light-on-top, formality coherence); hard rules (never, match, limits, occasion) reject outright. Rotation fairness compares an item with the peers eligible the same day for the same slot and adds up per item, so one over-worn piece costs as much as a clear style difference. The exact same outfit never repeats within 30 days; items worn yesterday sit out (shoes and outerwear only half-way).

## Acceptance criteria (brief) and where they stand

| Criterion | Phase | Status |
| --- | --- | --- |
| Bulk-upload 30 photos, a card each within 3 min on WebGPU, ≥ 80 % category accuracy on the fixture set | 1 | pipeline built; timing and accuracy to be measured on the owner's wardrobe (`fixtures-private/`, gitignored) |
| A corrected field persists and is never overwritten by a later model run | 1 | implemented (`userEdited`), unit-level |
| Today shows a weather- and occasion-correct outfit with a reason; swap, shuffle, lock without reload | 1 | implemented |
| Evening occasion dressed for the evening feels-like; rainy cool day never suede or canvas | 1 | tested (`recommend.test.ts`, `weather.test.ts`) |
| "I wore this" writes one WearEntry per item; calendar shows the day | 1 | implemented (one entry per item per moment; counters once per day; the calendar shows every outfit of the day) |
| Fixture outfit the slides call right ≥ 0.8; wrong rejected | 1 | tested (`rules.test.ts`) |
| 90-day simulation: every item within ±20 % of its fair share | 1 | engine measured at ±35 %/±3 on the deliberately awkward fixture (77 % of items within ±20 %); real-wardrobe measurement in the pilot |
| 7- and 30-day plans | 2 | 1–14 day plans built (pulled forward 2026-11-03); 30 days would exceed the 16-day forecast, so the horizon stops at 14 |
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

- **Simple mode (0.2, the owner's request on 2026-11-03: "as simple as possible, enter your clothes, say where you're going").** A card asks for nothing: the item's name is the model's answer, *Change* offers type and colour and nothing else; pattern, material, warmth, formality and seasons stay model- and taxonomy-derived. Today opens on "Where are you going?" and the outfit follows the tap; weekday defaults, the hours editor, lock, keep-for-later and the day strip left the screen (the data model keeps the fields; backups from 0.1 restore). Settings keep location, language, backup and delete; the engine's knobs (runs hot/cold, cooldown days, wears before wash, sneakers at the office, suede in rain, background removal) keep their defaults in data and are no longer shown. Plan-ahead lives in a sheet, starts tomorrow and takes one occasion for the days it creates.
- **Photos sit on white.** The cutout is composited on an opaque white background in the worker (the stored photo and thumbnail are white-backed, and every thumbnail tile is white in both themes): on the dark theme the transparent cutouts looked black. The classifier now scores the white-backed cutout too, which turned the flat test shirt from "black t-shirt" into "light blue t-shirt".
- **Nothing reloads the page by itself, and a reload loses nothing.** The service worker runs in `prompt` mode: a new build shows a banner ("A new version is ready · Reload") and waits, never while photos are processed; the first deploys used `autoUpdate`, whose automatic reload threw away a photo batch the owner was adding. Pull-to-refresh is disabled (`overscroll-behavior-y: none`). The add queue lives in IndexedDB (`intake`) from the moment a photo is picked until its card is confirmed or discarded, so a crash, the camera on iPhone or any reload brings the same cards back ("Resumed n photos from before") and processing continues (`scripts/smoke-resume.py` proves it).
- The brief's "one outfit a day" became "any number of moments per day" on the owner's request (2026-11-03): a second outfit for the evening, or a plan of several days. Items worn earlier the same day count as worn yesterday for the cooldown, and counters move once per day.
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
