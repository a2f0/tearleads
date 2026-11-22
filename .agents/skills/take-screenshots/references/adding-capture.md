# Adding screenshot capture to a repository

Every repository that captures screenshots follows one contract, so
`agent-tool screenshots capture`, the shared store, and the matrix audit work
the same way everywhere. The capture code itself stays in the repository: it knows the
app's routes, seed data, and devices.

## Contract

- Root package script `screenshots` runs the whole capture and forwards extra
  arguments (a layout or project filter) to the runner.
- It writes below `<root>/.screenshots/`, resolved from the repository root,
  never from the current directory. Honor `SCREENSHOT_OUTPUT_DIR` when the
  runner already supports it, defaulting to `.screenshots`.
- The root `.gitignore` lists `.screenshots` with no trailing slash, so the
  symlink to the store is ignored too.
- Capture code removes or replaces files inside `.screenshots`, never
  `.screenshots` itself, and leaves `capture.json` alone.
- Builds never capture. A `build:*` or deploy script reads `.screenshots`
  only. A build that publishes screenshots checks `.screenshots/capture.json`
  before and after copying and prints the capture's commit (see
  [deploy guard and gallery](#deploy-guard-and-gallery)).
- Browser phone layouts are captured at the full 390x844 screen, so framed
  phones keep a real phone's proportions; native store captures keep each
  device's required size.
- Build caches stay honest: a cached task that copies screenshots hashes them
  through the link, or runs uncached (see [build caches](#build-caches)).
- Document the prerequisites and output layout in the repository's own docs,
  and point agents at this skill from `AGENTS.md` in one sentence.

## Layout

Use one of two shapes, named by what consumes them:

| Consumer | Layout | Example |
| --- | --- | --- |
| Website gallery or docs | `<layout>/<theme>/<screen>.png`, layouts `web`, `ipad`, `mobile`, themes `light`, `dark` | tearleads `.screenshots/mobile/dark/home.png` |
| Store listings (fastlane) | `<platform>/<device>/<NN-screen>[-dark].png` | nc `.screenshots/ios/iphone/01-home.png` |

Screen names are kebab-case and stable: a website keeps an allowlist and order
of them, so renaming one is a change to both.

## Web capture with Playwright

The pattern tearleads uses (`packages/app-web/playwright.screenshots.config.ts`
and `packages/app-web/screenshots/`):

- A separate Playwright config, so capture never runs in the e2e suite:
  `workers: 1`, `retries: 0`, a long test timeout, fixed `locale` and
  `timezoneId`.
- One project per layout:
  - `web`: `viewport: { width: 1440, height: 900 }`, `deviceScaleFactor: 2`;
  - `ipad`: `...devices["iPad Pro 11"]`;
  - `mobile`: `...devices["iPhone 13"]` with `viewport` and `screen` set to
    `{ width: 390, height: 844 }`, the full phone screen of an installed app
    (1170x2532 PNGs). The profile's own 390x664 viewport is Safari's visible
    area and makes framed phones look too wide;
  - `browserName: "chromium"` for all three, so output does not depend on
    WebKit; the device profiles still give touch input, viewport, and scale.
- Its own `webServer` entries on fixed, repository-specific ports with
  `reuseExistingServer: false`, against deterministic seed data or in-memory
  backends, never staging or production.
- Each theme is pinned through the app's stored preference and a reload, then
  verified (for example on `data-theme`) before capturing.
- Animations disabled with injected CSS after every navigation; wait for real
  readiness (data rendered, images decoded) instead of fixed sleeps.
- `page.screenshot({ path })` for routed layouts, or an element screenshot for
  a windowed desktop app; `mkdir` the theme directory first.

## Native capture with Maestro

The pattern nc uses (`scripts/testing/takeIosScreenshots.sh`,
`takeAndroidScreenshots.sh`, `maestro/screenshots/`):

- Dedicated, named simulators and emulators created on demand, so captures
  never depend on a day-to-day device's state; shut them down on exit.
- Status bar overridden to 9:41, full signal, battery discharging at 100%
  (`xcrun simctl status_bar ... override`; Android demo mode).
- Appearance set per capture (`xcrun simctl ui <udid> appearance dark`), with a
  short settle before the screenshot.
- Maestro flows only navigate; the shell script takes the screenshot
  (`xcrun simctl io <udid> screenshot --mask=ignored`, `adb exec-out screencap`).
- Validate every file: the exact store size for the device, and no alpha
  channel, which App Store Connect and Play reject.
- Maestro's driver uses port 7001 for every device, so one Maestro run drives
  this machine at a time: check for a running `maestro` before starting.

## Deploy guard and gallery

A website that publishes screenshots stages them with
`agent-tool screenshots build <target>` from the pinned `@a2f0/agent-tool`
(0.1.32 or later), configured in the `screenshots` section of
`agent-tool.json`, rather than its own copy script. It copies the allowlisted
`<project>/<theme>/<screen>.png` files with content-hashed URLs and writes a
manifest, and it checks `.screenshots/capture.json` before and after copying.
Every capture writes a `running` record before it touches an image, so an
unchanged `complete` record on both sides proves no capture overlapped the
copy. It refuses a capture that is not complete, names no commit, is
dirty, or changed meanwhile, and a linked, non-empty store with no record
(its images have no known commit, as after `link` moves an older capture into
the store). A missing or plain `.screenshots` (CI, an unlinked clone) builds
with what it holds, or an empty manifest.

Pages render that manifest with the package's framework-free elements from
`@a2f0/agent-tool/screenshots/gallery` and its stylesheet:
`<screenshot-gallery>` for a `/screenshots/[...slug]` route (deep links per
project and screen, a scrolling stage, a filmstrip, phone bezels) and
`<screenshot-carousel>` for a looping row of every phone screen on a home
page. Sites theme them with `--shots-*` custom properties. The package's
`docs/screenshots.md` has the configuration, attributes, and an Astro example;
tearleads and balebase are the references.

A non-website consumer (a store upload) that copies captures itself must apply
the same before-and-after record check.

## Build caches

Turbo and similar caches hash declared inputs. A task that stages screenshots
must see changes made through the link: confirm that its input globs follow
the `.screenshots` symlink (recapture one screen and check the task misses its
cache), or mark the staging task `cache: false`.
