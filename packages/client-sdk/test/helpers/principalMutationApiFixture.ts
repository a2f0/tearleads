import type { ApiClient } from "@tearleads/api-client";
import type { PrincipalMutationRecoveryApi } from "../../src/workflows/organizations/principalMutationJournalManagement";

const bindings = new WeakMap<
  ApiClient,
  ApiClient & PrincipalMutationRecoveryApi
>();

/** Preserve a shared client's methods and identity without attaching test stubs. */
export function principalMutationApiFixture(
  api: ApiClient,
  recovery: PrincipalMutationRecoveryApi,
): ApiClient & PrincipalMutationRecoveryApi {
  const cached = bindings.get(api);
  if (cached) return cached;
  const methods = new Map<PropertyKey, { source: unknown; bound: unknown }>();
  const proxy = new Proxy(api, {
    get(target, property) {
      const source: unknown = Reflect.get(target, property, target);
      if (source === undefined && Object.hasOwn(recovery, property))
        return Reflect.get(recovery, property);
      if (typeof source !== "function") return source;
      const previous = methods.get(property);
      if (previous?.source === source) return previous.bound;
      const bound = source.bind(target);
      methods.set(property, { source, bound });
      return bound;
    },
  }) as ApiClient & PrincipalMutationRecoveryApi;
  bindings.set(api, proxy);
  return proxy;
}
