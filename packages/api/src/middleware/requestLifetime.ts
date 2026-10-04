export interface RequestLifetimeBindings {
  readonly beginPrincipalHistoryVerification?: () => void;
}

/** Invoked by policy workflows inside an authenticated request scope. */
export function createRequestLifetimeBindings(
  request: Request,
  server: { timeout(request: Request, seconds: number): void },
): RequestLifetimeBindings {
  return {
    beginPrincipalHistoryVerification: () => server.timeout(request, 0),
  };
}
