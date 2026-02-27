import { bypass, HttpResponse, http } from 'msw';

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
      const target = new URL(
        pathname + original.search,
        `http://localhost:${String(targetPort)}`
      );

      const response = await fetch(
        bypass(
          new Request(target, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            // @ts-expect-error -- duplex is needed for streaming request bodies
            duplex: 'half'
          })
        )
      );

      return new HttpResponse(await response.arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers)
      });
    })
  ];
}
