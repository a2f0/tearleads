/**
 * The script of the app and demo Workers (`wrangler.app.jsonc`,
 * `wrangler.demo.jsonc`). Cloudflare serves a request that matches a file
 * straight from static assets, and answers a navigation to a client route
 * (`Sec-Fetch-Mode: navigate`) with `index.html`, so this runs only for a
 * request that matches no file and is not marked as a navigation.
 *
 * A request for a missing file must not receive `index.html`: a module script
 * or service worker precache asking for a chunk the serving version lacks (a
 * deploy still propagating) would then store the HTML under the chunk's path,
 * and the `/chunk-*` header rule would mark it immutable for a year. The
 * service worker would serve that HTML to every later load as the entry
 * module, a white screen that outlives the deploy. A non-cacheable 404 instead
 * fails the load, and the service worker's install with it, until a request
 * reaches the new version.
 */

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface MissingAssetWorkerEnv {
  ASSETS: AssetsBinding;
}

export default {
  fetch(
    request: Request,
    env: MissingAssetWorkerEnv,
  ): Response | Promise<Response> {
    // Some document requests for client routes arrive without the navigate
    // mark: Firefox forwards a service worker's `fetch(event.request)` as
    // `Sec-Fetch-Mode: same-origin`, and browsers without Fetch Metadata send
    // no mode at all. They still accept HTML, unlike script, style, image,
    // worker, and fetch requests, so they keep getting the app shell.
    if (request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(request);
    }
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  },
};
