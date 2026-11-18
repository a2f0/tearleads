/**
 * Requests no longer carry the manifest they commit to (the API derives it),
 * but tests that rebuild acknowledged material need it: the helper that
 * builds a request records the manifest it derived here, keyed by the
 * request's signed event, which a copy of the request keeps.
 */
const manifestsByEvent = new WeakMap<object, Record<string, unknown>>();

export function rememberRequestManifest<T extends { readonly event: object }>(
  request: T,
  manifest: object,
): T {
  manifestsByEvent.set(request.event, { ...manifest });
  return request;
}

export function rememberedRequestManifest(request: {
  readonly event: unknown;
}): Record<string, unknown> | undefined {
  const { event } = request;
  return typeof event === "object" && event !== null
    ? manifestsByEvent.get(event)
    : undefined;
}
