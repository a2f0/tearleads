import { bypass, HttpResponse, http } from 'msw';

type RequestInitWithDuplex = RequestInit & {
  duplex?: 'half';
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createExpressPassthroughHandlers(
  baseUrl: string,
  targetPort: number,
  pathPrefix = ''
) {
  return [
    http.all(new RegExp(`^${escapeRegex(baseUrl)}`), async ({ request }) => {
      const original = new URL(request.url);
      // Prepend pathPrefix (e.g. '/v1') unless the path already starts with it
      let pathname = original.pathname;
      if (pathPrefix && !pathname.startsWith(pathPrefix)) {
        pathname = pathPrefix + pathname;
      }
      const normalizedPathname = `/${pathname.replace(/^\/+/, '')}`;
      const target = new URL(`http://localhost:${String(targetPort)}`);
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
