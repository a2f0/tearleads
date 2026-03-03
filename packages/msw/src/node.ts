import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { createExpressPassthroughHandlers } from './passthroughHandlers.js';

export interface RecordedApiRequest {
  method: string;
  pathname: string;
  url: string;
}

const recordedApiRequests: RecordedApiRequest[] = [];

export const server = setupServer();

server.events.on('request:start', ({ request }) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith('.wasm')) {
    return;
  }
  recordedApiRequests.push({
    method: request.method.toUpperCase(),
    pathname: url.pathname,
    url: request.url
  });
});

export const clearRecordedApiRequests = (): void => {
  recordedApiRequests.length = 0;
};

export const resetMockApiServerState = (): void => {
  clearRecordedApiRequests();
};

export const getRecordedApiRequests = (): RecordedApiRequest[] => [
  ...recordedApiRequests
];

export const wasApiRequestMade = (
  method: string,
  pathname: string | RegExp
): boolean => {
  const normalizedMethod = method.toUpperCase();

  return recordedApiRequests.some((request) => {
    if (request.method !== normalizedMethod) {
      return false;
    }

    if (typeof pathname === 'string') {
      return request.pathname === pathname;
    }

    return pathname.test(request.pathname);
  });
};

export function configureForExpressPassthrough(
  baseUrl: string,
  port: number,
  pathPrefix = '/v1'
): void {
  const base = baseUrl.replace(/\/$/, '');
  server.resetHandlers(
    http.get(`${base}/v2/ping`, () =>
      HttpResponse.json({
        status: 'ok',
        service: 'api-v2',
        version: '0.1.0-test'
      })
    ),
    ...createExpressPassthroughHandlers(baseUrl, port, pathPrefix)
  );
}

export { HttpResponse, http } from 'msw';
