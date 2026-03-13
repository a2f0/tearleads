import { bypass, HttpResponse, http } from 'msw';

export interface ExpressPassthroughRouteOverride {
  pathnamePattern: RegExp;
  targetPort: number;
  pathPrefix?: string;
  /** Strip this prefix from the pathname before forwarding */
  stripPathPrefix?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createExpressPassthroughHandlers(
  baseUrl: string,
  targetPort: number,
  pathPrefix = '',
  routeOverrides: ExpressPassthroughRouteOverride[] = []
) {
  return [
    http.all(new RegExp(`^${escapeRegex(baseUrl)}`), async ({ request }) => {
      const original = new URL(request.url);
      const routeOverride = routeOverrides.find((override) =>
        override.pathnamePattern.test(original.pathname)
      );
      const resolvedTargetPort = routeOverride?.targetPort ?? targetPort;
      const resolvedPathPrefix = routeOverride?.pathPrefix ?? pathPrefix;

      // Strip prefix (e.g. '/v1') when the override target doesn't use it
      let pathname = original.pathname;
      const strip = routeOverride?.stripPathPrefix;
      if (strip && pathname.startsWith(strip)) {
        pathname = pathname.slice(strip.length) || '/';
      }
      // Prepend pathPrefix (e.g. '/v1') unless the path already starts with it
      if (resolvedPathPrefix && !pathname.startsWith(resolvedPathPrefix)) {
        pathname = resolvedPathPrefix + pathname;
      }
      const normalizedPathname = `/${pathname.replace(/^\/+/, '')}`;
      const target = new URL(`http://localhost:${String(resolvedTargetPort)}`);
      target.pathname = normalizedPathname;
      target.search = original.search;

      const includeBody = request.method !== 'GET' && request.method !== 'HEAD';
      const proxiedRequestInit: RequestInit = {
        method: request.method,
        headers: request.headers
      };
      if (includeBody) {
        proxiedRequestInit.body = await request.arrayBuffer();
      }
      const response = await fetch(
        bypass(new Request(target, proxiedRequestInit))
      );

      return new HttpResponse(await response.arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers)
      });
    })
  ];
}
