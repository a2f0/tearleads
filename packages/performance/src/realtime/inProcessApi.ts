import type * as TestRuntime from "@tearleads/api/test-runtime";

export interface InProcessApi {
  readonly origin: string;
  readonly authorizeContainerAccess: typeof TestRuntime.authorizeContainerAccessWithWorkflow;
  readonly createRealtimeGateway: typeof TestRuntime.createRealtimeGateway;
  readonly stop: () => Promise<void>;
}

/**
 * The API served in this process from `@tearleads/api/test-runtime`, over
 * real HTTP so the SDK reaches it exactly as a deployed client would. Import
 * it only after `DATABASE_URL` points at the measured database: the API
 * reads its database configuration when the module loads.
 */
export async function startInProcessApi(): Promise<InProcessApi> {
  const api = await import("@tearleads/api/test-runtime");
  await api.initializeApiDatabase();
  let routeApp: ReturnType<typeof api.createRouteApp> | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      routeApp
        ? routeApp.fetch(request)
        : new Response("Starting", { status: 503 }),
  });
  const origin = server.url.origin;
  // Identities name the API's origin as their trust domain, as they do
  // against a deployment with an explicit domain.
  routeApp = api.createRouteApp({
    runtime: {
      ...api.getDefaultApiServiceRuntime(),
      identityTrustDomain: origin,
    },
  });
  return {
    origin,
    authorizeContainerAccess: api.authorizeContainerAccessWithWorkflow,
    createRealtimeGateway: api.createRealtimeGateway,
    stop: () => server.stop(true),
  };
}
