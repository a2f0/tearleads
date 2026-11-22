# Framework notes

## Astro

- Inject the tier with `vite.define` on an `import.meta.env.PUBLIC_*` value,
  so `astro.config.*` and the pages agree on it. Astro integrations do not
  receive `--mode`; record it from a Vite plugin's `configResolved` hook, and
  throw when it is missing.
- Write JSON-LD with
  `<script is:inline type="application/ld+json" set:html={json}>` and escape
  `<` as `\u003c` in the serialized JSON.
- When conditional tags go into a named slot, wrap them as
  `<Fragment slot="head">{condition && …}</Fragment>` rather than putting the
  condition around an element that carries `slot=`. Test that the output
  lands inside `<head>`.
- In `astro:build:done`, page pathnames look like `""`, `"privacy/"`, and
  `"404/"`. Filter error pages out of the sitemap. `@astrojs/sitemap` works,
  or a small integration can write `sitemap.xml` and `robots.txt` from the
  built pages.
- Knip treats `astro.config.*` as plugin configuration, so a new integration
  file it imports may need to be listed as a production entry.

## Next.js static export

- A page that renders only on the client (`autoExport` with an empty
  `<div id="__next">`) gives crawlers nothing. `next/head` tags in a
  statically exported page do reach the HTML; the main copy needs build-time
  rendering, which is content work.
- With the pages router, put tier-wide tags such as the staging robots meta
  in `_document.tsx`, so `404.html` gets them too. Inline the tier through
  `next.config` `env` so the browser hydrates with the same tags; otherwise
  `next/head` can add or drop them on the client.
- Do not import relative TypeScript into `next.config.ts`.
- Add an explicit `pages/404.tsx` so the error page's head (noindex, no
  canonical, no `og:url`) is under the app's control, and pair it with
  `not_found_handling: "404-page"` when missing paths should get it.
- When two `next/head` instances emit the same tag, whichever re-rendered
  last wins, even with matching `key`s. Keep one owner for a dynamic tag such
  as `theme-color`. When the theme provider renders on the client below
  `<Head>`, read the attribute it stamps on `<html>` instead.
- `next build` clears `out/`, so write `robots.txt`, `sitemap.xml`, and
  `_headers` after it. With a single-page fallback on the host, a missing
  file is answered with HTML.

## Monorepo tooling

- Turborepo strict environment mode drops undeclared variables, so declare a
  tier variable in `turbo.json` `env`. Declaring it also keeps the two tiers'
  caches apart.
- In a package script, `VAR=x a && b` sets the variable for `a` only.
- A broad ignore pattern such as `build/` can also match a new
  `scripts/build/` file, so `git add -A` silently skips it. Run
  `git check-ignore` on new files.
- A production check of "no noindex anywhere" fails when a site copies
  deliberately noindexed pages from a package. Check the header rules and the
  pages the site owns.
- When a package's pages are copied into another site, give them absolute
  canonical, `og:url`, and JSON-LD URLs on their own production host, never
  derived from the request host, so the copies point back to the original.
  Keep robots.txt, the sitemap, the preview image, and the 404 page out of
  the package; they belong at the deployment root. Any change to files in
  the published tarball follows the repository's versioning policy, and the
  report names the release a consuming site needs.
- Tests that fetch every `src` and `href` in a page will fetch an absolute
  canonical from the live network; filter them to relative references.

## Theme-color with a theme switch

Keep one owner for the tag. The simplest owner is the script that applies the
saved theme before first paint: let it write `theme-color` and watch the
theme attribute it sets (for example `data-theme` on `<html>`), so framework
components never write the tag.

## Runtime titles

Code that sets `document.title` after load, such as the name of an open
document, replaces the static title that crawlers which run JavaScript index.
Search for `document.title` before writing a static title. When the product
behavior must stay, use the form `<document> · <what the page is> · <brand>`;
the brand alone is not descriptive. Check whether the title callback is part
of a published API before changing it, and read the rendered title in a
headless browser after the app mounts, not at the load event.

## Vite single-page apps

- Put static tags in `index.html`. For tier-conditional tags, use a plugin
  hook such as `transformIndexHtml`, or `vite-plugin-html`'s `inject.tags`.
  EJS scriptlets in `index.html` can break linters that parse HTML, such as
  Biome.
- The public directory is copied before `writeBundle`, so a plugin can edit
  the built `_headers` there. Insert into the existing `/*` rule.
- An extensionless relative import in `vite.config.ts` can trigger Vite's
  native config loader warning; keep small plugins inline or use an explicit
  extension.
- To give a client-routed site per-route metadata without a framework
  change, list the routes once and write one copy of the app shell per route
  (for example `company.html`) with that route's tags. Then switch the host to
  a 404 page that is the same shell, so client routing still works. Every
  routed path needs its own document, including flag-gated and nested routes,
  or a reload of that path returns 404.
- Model the head tags once, render them at build time, and reapply them on
  client navigation. Updating only `document.title` leaves a stale canonical,
  description, and robots tag; reviewers rate that as a major finding.

## Bun's HTML bundler

It leaves absolute canonical and Open Graph URLs and JSON-LD blocks
untouched, so static tags in the source HTML survive the build.

## react-native-web

- The page is empty until the bundle runs; record that as a recommendation
  when you cannot prerender a static summary.
- `accessibilityRole="header"` renders an `<h1>` with no visual change and
  marks the heading for native screen readers.

## Service workers

Apply tier-specific tags after the build but before the precache manifest
is generated, so the cached shell matches its tier.

## Preview images with agent-tool

Render `og-image.png` with `agent-tool images` from `assets/brand/` sources:
an output with `"size": [1200, 630]`, a background or fill layer, and the logo
layer. The renderer loads no fonts, so the image cannot contain text unless
it is converted to paths. Choosing the target:

- Default to a separate target, such as `social`, beside `favicons`, and
  follow `dir` targets when the repository already uses them.
- Extending an existing target is fine when only one package uses it and no
  test ties it to the linked icons; a target shared by several packages
  through `--out` would put the image in every package's build.
- Check service worker precache globs: a PNG in a precached `public/` folder
  bloats the offline cache.
- `build --out <dir>` takes exactly one target and an absolute or
  repository-relative directory. Repositories that ban committed binaries
  render the image during the build, production only if it is tier-specific.

Sources must meet agent-tool's rules in its `docs/images.md`: `<title>`,
`<desc>`, and `<metadata>` are allowed, while `<style>`, `style` attributes,
text, and elements from editor namespaces are not. The practical test is
whether `agent-tool images build` succeeds. When the only logo is an editor
export that fails, record the needed plain SVG instead of rendering from it.
