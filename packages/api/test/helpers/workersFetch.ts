/**
 * Gives a fake `fetch` the receiver check Cloudflare Workers' `fetch` performs:
 * invoked as a method of another object (`input.fetchImpl(...)`), it throws
 * "Illegal invocation". Bun's `fetch` and arrow-function fakes accept any
 * receiver, so without this a test cannot see that production failure.
 */
export function workersFetch(
  respond: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return function fetchWithReceiverCheck(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError(
        "Illegal invocation: function called with incorrect `this` reference.",
      );
    }
    return respond(input, init);
  } as typeof fetch;
}
