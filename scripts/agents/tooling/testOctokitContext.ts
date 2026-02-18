import { Octokit } from '@octokit/rest';
import type { GitHubClientContext } from './utils/githubClient.ts';

function toUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function createContext(
  responder: (request: { url: string; method: string; body: unknown }) => {
    status: number;
    body: unknown;
  }
): GitHubClientContext {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = toUrlString(input);
    const method = init?.method ?? 'GET';
    const rawBody =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : '';
    const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null;
    const { status, body } = responder({ url, method, body: parsedBody });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };

  return {
    octokit: new Octokit({
      auth: 'test-token',
      request: { fetch: mockFetch }
    }),
    owner: 'a2f0',
    repo: 'tearleads'
  };
}
