import type { PrincipalHistoryProtectionLease } from "./principalHistoryProtection";

const leases = new WeakMap<object, PrincipalHistoryProtectionLease>();

/** Internal workflow adapters carry custody without exposing it on public views. */
export function readPrincipalHistoryProtection(runtime: object) {
  const internal = runtime as {
    readonly withPrincipalHistoryProtection?: PrincipalHistoryProtectionLease;
  };
  return leases.get(runtime) ?? internal.withPrincipalHistoryProtection;
}

export function inheritPrincipalHistoryProtection<T extends object>(
  source: object,
  target: T,
): T {
  const lease = readPrincipalHistoryProtection(source);
  if (lease) leases.set(target, lease);
  return target;
}
