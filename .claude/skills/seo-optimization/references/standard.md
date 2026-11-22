# Standard by host class

Read "Every host" and the sections for the host classes you found. Sources
worth opening when a rule matters:
[Google Search Central](https://developers.google.com/search/docs),
[robots meta and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag),
[canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls),
[sitemaps](https://www.sitemaps.org/protocol.html),
[structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies),
and [the Open Graph protocol](https://ogp.me/).

## Every host

- Every HTML page carries one `theme-color` that matches its top chrome, or
  its background when it has no header, in each theme. When views differ, use
  the first view a visitor sees, such as the sign-in page.
- When an in-app appearance toggle changes that color, the tag must follow it
  at runtime, not only through `prefers-color-scheme` variants, and exactly
  one piece of code may own it. This is browser chrome, not ranking: when
  following an app's own theme system needs app UI work, record it as a
  recommendation instead.
- Hosts that this repository's infrastructure binds but another repository
  builds and deploys belong to that repository's pass.

## Non-production tiers

A repository with only a production tier skips this section, but still
checks the platform's duplicate hosts, such as `*.workers.dev`.

- Send `X-Robots-Tag: noindex, nofollow` on every response, including assets,
  fallbacks, error pages, redirects, and robots.txt. A non-production API host
  that answers only JSON follows the API rule under
  [Internal hosts](#internal-hosts).
- Put `<meta name="robots" content="noindex, nofollow">` in every HTML
  document, so a copied or cached page still carries it.
- Keep robots.txt crawlable. A missing file or a comments-only managed file
  already is; add or change a file only to remove a `Disallow`. A
  `Disallow: /` stops crawlers from fetching pages, so they never see the
  noindex and can still index a linked URL without its content.
- Emit no `<link rel="canonical">`, `og:url`, sitemap, or Sitemap line; those
  tell crawlers which URL to index. Other preview tags and structured data may
  stay, including `og:image` at the tier's own host or at production, so that
  shared staging links still preview.
- A zone-level redirect, such as HTTP to HTTPS, is answered before the
  application and cannot carry the header. Record it; the target carries the
  header.
- Derive the tier from the mechanism the repository already uses, such as a
  wrangler `env`, a build mode, or a release tier variable. Make the
  production build the explicit choice, fail on an unknown tier, and test
  both outcomes. When one artifact is promoted between tiers, apply the tier
  at deploy time, for example by writing `_headers` per environment, rather
  than breaking promotion.
- Leave an already-compliant tier unchanged after verifying it.

## Content hosts

1. **Static head.** The HTML served before JavaScript runs carries:
   - a unique `<title>` that names what the page is, with the brand (the
     product, or the person or site name on a personal site) last, kept under
     about 60 characters;
   - `<meta name="description">` of up to about 160 characters, written from
     the page's own copy;
   - `<link rel="canonical">` with the absolute production URL in the exact
     form the host serves without redirecting (trailing slash or not);
   - `<html lang>`, the viewport tag, and `theme-color`.

   The lengths are limits on what search results show, not targets: a short
   title that names a person or a page is fine, and padding with invented
   copy is not. Shortening an over-long description by choosing from its own
   sentences is a metadata edit; when it would need new wording, record it. A
   page that sets its title only from JavaScript needs static or prerendered
   metadata. When the app localizes text in the browser, localize a
   descriptive `document.title` too.
2. **Previews.** Add `og:type`, `og:site_name`, `og:title`,
   `og:description`, `og:url` (equal to the canonical), `og:image` (an
   absolute URL to a 1200×630 PNG), `og:image:width`, `og:image:height`,
   `og:image:alt`, and `twitter:card` = `summary_large_image`. Twitter falls
   back to the Open Graph title and description. Without a usable image, omit
   `og:image` and use `twitter:card` = `summary`.
3. **Structured data.** Add JSON-LD in `<script type="application/ld+json">`:
   - `WebSite` on every content host's home page, and `Organization` when the
     site names its publisher;
   - `SoftwareApplication` or `WebApplication` for a product, with
     `operatingSystem` listing only platforms a visitor can use today and
     `offers` only for prices the site already states;
   - `Person` for a resume, using only facts on the page.

   Escape `<` inside the JSON, and parse it in a test. Never add ratings or
   reviews that are not on the page.
4. **robots.txt.** Serve a real `text/plain` file with `User-agent: *`,
   `Allow: /`, any deliberate existing rules, and
   `Sitemap: https://<host>/sitemap.xml`. Keep earlier directives that had an
   effect, such as AI-crawler rules or `Content-Signal` lines, unless the user
   decides otherwise.
5. **Sitemap.** List the absolute canonical URL of every indexable page and
   nothing else: no error pages, redirects, placeholder pages, or
   non-production hosts. Generating it from the canonical links in the built
   HTML keeps the two from drifting.
6. **Status codes.** An unknown path returns 404 with a helpful page when the
   platform allows it; an empty 404 body is a gap. Do not remove a fallback
   that client-side routing or old-link redirects depend on; record the soft
   404 instead. The site should redirect `http://` to `https://`; when that is
   a CDN or zone setting, record it.
7. **Error page.** The same error page is served at any depth, so its links
   and assets need root-relative paths. Hosts often answer its own path (such
   as `/404`) with 200, so give it a robots noindex and no canonical, `og:url`,
   or sitemap entry; it is the one production page that carries noindex.
   Leave analytics off it when it can answer under paths with stricter privacy
   promises (a zone may still inject its own), and make the local development
   server answer missing paths the same way.
8. **Internal links.** Every link to the site's own pages uses the canonical
   form, so following it answers 200 without a redirect;
   `agent-tool seo probe --links` finds the others. Add a build test that
   fails on a link that would redirect or miss, generating any gitignored
   build assets it reads first.
   Changing link forms can break code that compares links with the current
   path, such as an active-page marker. Shared link constants in other
   packages count too, and changing them can require those packages' version
   bumps.
9. **Hygiene on touched pages.** One `<h1>` that names the page (not one
   shared by a whole gallery), meaningful `alt` text on content images, and
   descriptive link text. On image-heavy pages, keep only the likely Largest
   Contentful Paint image eager, with `fetchpriority="high"`, and lazy-load
   the rest with explicit `width` and `height`.
10. **Manifest.** Where a web app manifest exists, make the name, short name,
    description, icons, colors, `start_url`, and `display` accurate. Add
    `related_applications` only after the store listings exist.
11. **Copied pages.** When a site serves copies of another project's pages,
    for example from a package's asset folder, the copies should canonicalize
    to the original host. That is the producer's change: absolute canonical
    and `og:url` values in the pages it ships. On the consuming side, upgrade
    to a release whose tarball you have checked for the change, and review
    the API between the old and new versions first. Copies of pages that are
    deliberately kept out of search keep the producer's robots rules, but
    their assets can still be indexed: add a path-scoped `X-Robots-Tag` rule
    for the copied directory in production, where no `/*` rule already sends
    it, and respect any deploy guard the consumer has. Probe asset paths under
    the copy, not only its pages.

Paths on a content host that are not meant for search, such as review or
preview pages, get the internal-host treatment: the header, the robots meta,
and no sitemap entry. Placeholder pages without real copy do too, through a
flag on the page, so a page becomes indexable and joins the sitemap as soon
as it gets content.

When several sites belong to one company, give them the same `Organization`
node, with the same `@id`, name, legal name, URL, and logo, and point
`publisher` or `provider` at that `@id`.

## App hosts

- Replace a generic shell title such as "App" with the product name and what
  it is, for example "Tearleads – Encrypted notes, contacts, and files". Add a
  description and Open Graph tags.
- Reuse the product's preview image by pointing `og:image` at the content
  host's absolute URL rather than rendering a second copy, and deploy the
  content host first when the image changes. Requesting the image path on the
  app host itself may return the shell; check the URL the page names.
- Serve a real `text/plain` robots.txt. A single-page fallback otherwise
  answers it with HTML.
- Add a canonical pointing at the app root only when every route shows the
  same shell. When the app has distinct public, shareable routes, such as user
  pages or published documents, a root canonical marks them as duplicates.
  Omit the canonical and record whether those routes should be indexable. That
  is a product and privacy decision, because sharing by link is not consent to
  search listing.
- A host that serves a duplicate of another host's app, such as a demo build,
  canonicalizes to the primary app root.
- Once the product owner decides that public user-content routes stay out
  of search, noindex them with a path rule. If those routes cannot be told
  apart from app routes by URL pattern (for example `/:user` and `/admin`),
  send the header on every path below the root, detach it on built files,
  and keep the root indexable; say so in the report, because it also covers
  app routes. Add the robots meta in the view as well, never twice. Without
  that decision, record the question instead of noindexing anything.
- Private links that work without an account, such as signing or sharing
  URLs with a token, get `X-Robots-Tag: noindex, nofollow` through a path
  rule, while the rest of the app keeps its canonical. Files those pages link
  to on an API host, such as PDF downloads, should carry the header too.
- The content-host rule for localized titles applies to app hosts that
  localize in the browser.

## Internal hosts

Admin dashboards, galleries, package viewer sites, and other HTML surfaces
that are not meant for search follow every non-production rule above: the
header (`noindex, nofollow`) on every response, including server-generated
redirects and sign-in pages; the robots meta in the HTML; a crawlable
robots.txt; and no canonical, `og:url`, or sitemap. Empty preview and
structured-data results are expected on these hosts.

- API hosts that answer only JSON need nothing unless adding the header is
  trivial and leaves CORS and other behavior unchanged. On any tier, files
  they serve behind private links do need it.
- An existing `noindex` robots meta can stay as it is; the header carries
  `nofollow`. Do not change meta tags in pages that a package ships for other
  sites to copy, because the copies take them along. Keep host-only files such
  as `_headers` out of the package.
- A host with one tier has no tier switch to test. Test that every page has
  the robots meta and no canonical, and that the header is present: the rule
  in the deployed build for static assets, or a unit test of the wrapper when
  a Worker sets it in code. In a repository that also publishes the pages as
  a package, test that the package leaves the host-only header file out.
- When the repository has a verification script or a documented post-deploy
  check for the site, add the live header check there. Do not add SEO checks
  to gates for other releases, such as a package publishing gate.

## Apps that will ship to stores

Until the store listings are live, list only `Web` in `operatingSystem`, and
do not add smart app banners, `related_applications`, or new links to store
pages that answer 404. Existing store links may reflect an owner's decision,
so search the PR history and record a conflict rather than removing them.

Record what the launch needs: the App Store ID for `apple-itunes-app`, the
Play package for `related_applications`, store links in static HTML, offers
that match the listing, and, only if deep links are wanted,
`apple-app-site-association` (Team ID and bundle ID) and `assetlinks.json`
(the Play app signing certificate's SHA-256).
