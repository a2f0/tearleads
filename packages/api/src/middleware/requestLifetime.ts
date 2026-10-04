export interface RequestLifetimeBindings {
  readonly beginPrincipalHistoryVerification?: () => void;
}

/** Opt in only after authentication and input validation on history routes. */
export function createRequestLifetimeBindings(
  request: Request,
  server: { timeout(request: Request, seconds: number): void },
): RequestLifetimeBindings {
  return {
    beginPrincipalHistoryVerification: () => server.timeout(request, 0),
  };
}
