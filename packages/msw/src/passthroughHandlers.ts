import { bypass, HttpResponse, http } from 'msw';

type RequestInitWithDuplex = RequestInit & {
  duplex?: 'half';
};

export interface ExpressPassthroughRouteOverride {
  pathnamePattern: RegExp;
  targetPort: number;
  pathPrefix?: string;
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

      // Prepend pathPrefix (e.g. '/v1') unless the path already starts with it
      let pathname = original.pathname;
      if (!resolvedPathPrefix) {
        // Route overrides that opt out of prefixing should also strip '/v1'
        // so '/v1/connect/*' can be forwarded to targets expecting '/connect/*'.
        pathname = pathname.replace(/^\/v1(?=\/|$)/, '');
      }
      if (resolvedPathPrefix && !pathname.startsWith(resolvedPathPrefix)) {
        pathname = resolvedPathPrefix + pathname;
      }
      const normalizedPathname = `/${pathname.replace(/^\/+/, '')}`;
      const target = new URL(`http://localhost:${String(resolvedTargetPort)}`);
      target.pathname = normalizedPathname;
      target.search = original.search;

      const proxiedRequestInit: RequestInitWithDuplex = {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: 'half'
      };
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
