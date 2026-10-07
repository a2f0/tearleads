import type { PrincipalHistoryProtectionLease } from "./principalHistoryProtection";

const leases = new WeakMap<object, PrincipalHistoryProtectionLease>();

/** Internal workflow adapters carry custody without exposing it on public views. */
export function readPrincipalHistoryProtection(
  runtime: object & {
    readonly withPrincipalHistoryProtection?:
      | PrincipalHistoryProtectionLease
      | undefined;
  },
) {
  return leases.get(runtime) ?? runtime.withPrincipalHistoryProtection;
}

export function inheritPrincipalHistoryProtection<T extends object>(
  source: object,
  target: T,
): T {
  const lease = readPrincipalHistoryProtection(source);
  if (lease) leases.set(target, lease);
  return target;
}
