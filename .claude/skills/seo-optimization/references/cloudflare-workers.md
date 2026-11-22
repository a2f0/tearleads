# Cloudflare Workers hosting

Check these against the current
[static assets documentation](https://developers.cloudflare.com/workers/static-assets/)
when behavior matters; wrangler versions change details. Everything here was
observed on live Workers in 2026 with wrangler 4.

## Static asset headers

- `_headers` in the assets directory applies to every hostname of that
  Worker. A tier-specific header therefore needs a tier-specific build, or a
  deploy step that writes the file for each environment.
- Rules are keyed by path pattern, so a second block with the same pattern
  replaces the first block's headers instead of adding to them. Appending a
  separate `/*` noindex block can silently drop security or cache headers;
  add `X-Robots-Tag` inside the existing `/*` rule.
- Rules with different patterns merge. When two matching rules set the same
  header, the response carries it twice, so do not add a path rule for a
  header that `/*` already sets on that tier. `/x/*` matches `/x/` and below
  but not `/x`; add both patterns to cover the redirecting form.
- A `/*` rule reaches everything the asset handler answers: HTML, assets,
  the `html_handling` 307 redirects, single-page fallbacks, 404 responses,
  and robots.txt, including the zone's managed robots.txt when the origin has
  none.
- `_headers` does not apply to responses a Worker script generates, such as
  its own redirects, sign-in pages, or dynamic routes. A Worker with a `main`
  script needs the header set in code, driven by a tier variable in the
  wrangler `env`. With `run_worker_first: true`, `_headers` never applies;
  set the header in one wrapper around the router so every response gets it.
- `_headers` itself is never uploaded as an asset or served. Leave it out of
  any deploy check that lists the built files, and out of published packages.
- An authentication gate redirects robots.txt to the sign-in page unless the
  file is on the gate's public allowlist.
- `:name` placeholders match exactly one path segment and `*` matches the
  rest. A `! Header-Name` line detaches a header that an earlier matching rule
  set; it only works when it comes after that rule. A file has a limit of 100
  rules, so a build that generates rules per file should fail before reaching
  it.

## URLs and status codes

- `html_handling: "auto-trailing-slash"`, the default, answers the other form
  with a 307, so canonical URLs and internal links must use the form that is
  served directly. That form follows the file layout: `page/index.html` is
  served at `/page/`, and a flat `page.html` at `/page`, even when a `page/`
  directory exists; `/page.html` redirects too. `drop-trailing-slash` always
  serves the form without the slash.
- `not_found_handling: "none"`, the default, answers unknown paths with a 404
  and an empty body. On content hosts, add a `404.html` and switch to
  `"404-page"` so visitors get a helpful page.
- `"404-page"` serves the nearest `404.html` up the path with status 404,
  including for missing assets such as `/data/x.json`, which then receive
  `text/html`; that is fine for code that checks `response.ok`.
  `/404.html` itself redirects to `/404`, which answers 200, so the error
  page needs a robots noindex, and tests should use a missing path rather
  than the error page's own URL.
- `"single-page-application"` answers every unknown path with the app shell
  and a 200, a soft 404. It also answers `/robots.txt` and `/sitemap.xml`
  with HTML unless real files exist. Switch to `"404-page"` only when nothing
  depends on client-side routing.
- With a `main` script, the asset 404 page comes through `env.ASSETS.fetch`,
  while paths routed to the script first keep the script's own 404.
- A Worker that redirects every unmatched path, for example to keep old app
  links working, also redirects robots.txt and the sitemap. Generate both as
  build assets so the asset handler answers them first.
- A repository's deploy guard may pin the Worker's asset configuration.
  Update the guard with the change, and run its preview on the exact commit.

## Testing on the real runtime

- Development servers such as `vite preview` answer every path with the app,
  so status and header tests must run against `wrangler dev` or a deployed
  Worker. A test that only matches text in the configuration does not prove
  the behavior.
- A test can spawn `wrangler dev --config <config> --local --ip 127.0.0.1
  --port 0 --inspector-port 0 --persist-to <tmp>
  --show-interactive-dev-session=false`, adding `--assets <build>` when the
  configuration does not name the build directory. `_headers` and the
  configured `not_found_handling` apply, so status codes and the
  non-production `X-Robots-Tag` can be checked end to end. Details that
  matter:
  - spawn it with Node; under `bunx --bun` workerd has been seen to accept
    connections and never answer;
  - strip ANSI codes before matching the `Ready on` line, and keep draining
    stdout and stderr so the pipes do not fill;
  - set `WRANGLER_SEND_METRICS=false` and point `WRANGLER_LOG_PATH` at the
    temporary directory; it still writes a gitignored `.wrangler/tmp`;
  - stop it with SIGTERM, then SIGKILL;
  - prove the test by reverting the setting and watching it fail.
- `wrangler dev` reloads an edited `_headers` without a restart, which makes
  checking merged rules cheap.
- Deploying the branch to the non-production tier before merging is a cheap
  way to confirm routing, headers, and status codes on the real runtime.

## Duplicate hosts

Every Worker can also answer at `<worker>.<subdomain>.workers.dev` and at
per-version preview hosts, `<first 8 characters of the version ID>-<worker>.<subdomain>.workers.dev`.
Both serve full copies of the site.

- Set `workers_dev: false` and `preview_urls: false` in every environment
  unless something depends on those URLs: check API base URLs, CORS and
  authentication origins, docs, tests, and CI first.
- When the configuration has no `routes`, for example because Terraform binds
  the custom domain, wrangler enables `workers_dev` by default. An unset
  `preview_urls` leaves the existing setting alone, so preview hosts can be
  live despite the documented default.
- When `workers_dev` is on, the deploy output names the `workers.dev` URL;
  probe it and a preview host before and after. With an explicit `false` in
  every environment, a deploy whose output names no `workers.dev` target is
  enough evidence. A disabled or missing Worker on a valid subdomain answers
  error 1042, so a probe cannot tell the two apart. When API credentials are
  already available, the read-only
  `GET /accounts/{id}/workers/scripts/{name}/subdomain` returns `enabled` and
  `previews_enabled`; never read an OAuth token out of wrangler's
  configuration to call it.

## Zone settings and redirects

- Zone-wide settings, such as `always_use_https`, belong to exactly one
  Terraform stack, usually production, never a module that both tiers use.
  The Cloudflare provider cannot destroy a `cloudflare_zone_setting`:
  removing it from Terraform leaves the setting as it is.
- Before turning on Always Use HTTPS, check that nothing depends on plain
  HTTP: API base URLs in web, desktop, and native clients, webhook endpoints
  registered with providers such as Stripe (list them read-only), and OAuth
  or payment return URLs. Providers rarely follow a redirect on a webhook
  POST.
- A `www` to apex redirect needs no origin: a proxied `AAAA` record for `www`
  with content `100::`, and a `cloudflare_ruleset` in phase
  `http_request_dynamic_redirect` whose rule matches
  `http.host eq "www.<zone>"` and answers 301 with
  `concat("https://<zone>", http.request.uri.path)`, preserving the query
  string. Universal SSL already covers `www`. Single redirects run before
  Workers, so the rule works even while `www` is still a Worker custom
  domain.
- A zone has one ruleset per phase: extend or import an existing one.
- The redirect needs the token permission Zone → Single Redirect → Edit
  ("Dynamic URL Redirects Write"). A token without it gets
  `403 request is not authorized` even when reading the phase entrypoint, so
  read it first and stop before writing Terraform the token cannot apply.
  Never widen a token's permissions yourself.
- When the user authorizes it, the `cf` CLI, signed in as the account owner,
  can create the rule (`cf rulesets entrypoint update
  http_request_dynamic_redirect -z <zone> --name Redirects --rules
  @rules.json`, with `--validate-only` first) and the record
  (`cf dns records create`). Document such configuration in the repository:
  what exists, how to recreate it, and that Terraform must import it later.
- Repositories whose apply step refuses plans that delete resources need an
  explicit decision before a change that removes a custom domain.

## Cloudflare's managed robots.txt

A zone can serve a Cloudflare-managed robots.txt. Observed behavior:

- a zone with only the content-signals policy serves a comments-only file
  when the origin has no robots.txt, and the origin file replaces it
  entirely;
- a zone that also manages AI-crawler rules prepends its block, with
  `Content-Signal` and `Disallow` directives, to the origin file, and serves
  it alone where the origin answers 404;
- where the origin answers `/robots.txt` with a 404, the managed file is
  served with status 200 and keeps the origin's other headers, including an
  `X-Robots-Tag` from `_headers` or Worker code;
- a single-page fallback that answers `/robots.txt` with HTML suppresses
  either file.

Before serving your own file, record which directives were live, such as
`Content-Signal` lines or `Disallow` rules for AI crawlers. Keep their effect
in the origin file, or ask the user. Comments-only managed files carry no
directives. Do not change the zone setting without explicit authorization.

## Deploys and verification

- Merging is not deploying in many repositories: they deploy by hand with an
  existing `wrangler login` session or documented credentials. Check the
  deploy docs and confirm the new version is live. Custom domains owned by
  Terraform make `wrangler deploy` report no targets deployed; that is
  normal.
- A manual deploy ships everything merged since the last one, so find out
  what is live first, check again just before deploying, and report what else
  went live. Compare pages at the URLs they are served from (`/`, not
  `/index.html`, which redirects with an empty body), and compare with a
  plain client: the zone may inject scripts, such as an analytics beacon,
  only for browser user agents.
- `wrangler deployments list` shows times and version IDs but usually no
  commit. `_headers` is not served, so compare its rules with live response
  headers rather than bytes. In wrangler's output, "Uploaded N (M already
  uploaded)" counts assets; "Read N files" also counts directories. Passing
  `--message <commit>` to `wrangler deploy` makes later comparisons easy;
  suggest it rather than adding it unasked.
- A hostname that does not resolve may belong to a Terraform stack that a
  teardown destroyed and no deploy re-applies. Check that stack's state with
  a read-only plan before assuming a DNS fault, and check that the content
  behind it, such as uploaded release files, exists too.
- A manual deploy can build from gitignored local inputs, such as captured
  screenshots or generated data. Compare them with what is live before
  deploying, so a stale local copy does not regress production.
- A configuration change to an API Worker, even `workers_dev`, is an API
  release that may pull in migrations, secrets, and infrastructure steps.
  Check pending migrations first (for D1,
  `wrangler d1 migrations list <database> --remote`).
- Some repositories deploy staging from a branch such as `staging`. Moving it
  is a deploy, so do it only when deploying is authorized and the
  repository's docs name that branch as the staging trigger: fast-forward
  only, never force, and report how far it moved.
- "Always Use HTTPS" is a zone setting. When `http://` answers 200 instead of
  redirecting, record it rather than changing the zone, and say where the fix
  belongs: Terraform can manage it as a `cloudflare_zone_setting` with
  `setting_id = "always_use_https"`, so check whether the repository or a
  sibling repository already does.
