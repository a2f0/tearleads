import type { ApiClient } from "@tearleads/api-client";
import type { SigningKeyPair } from "@tearleads/crypto";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  abandonJournaledPrincipalMutation,
  discardUnreadableJournaledPrincipalMutation,
  type PrincipalMutationRecoveryApi,
  readJournaledPrincipalMutation,
} from "../workflows/organizations/principalMutationJournalManagement";
import { recoverJournaledPrincipalMutation } from "../workflows/organizations/principalMutationJournalSession";
import {
  createJournaledPrincipalMutations,
  dispatchAuthoredPrincipalMutation,
  type JournaledPrincipalMutationMethods,
} from "./principalMutationDispatch";

export interface PrincipalMutationRuntimeScope {
  readonly database: object;
  readonly execSql: ExecSql;
  readonly generation: number;
  readonly identityTrustDomain: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly userId: string;
}

function sameScope(
  current: PrincipalMutationRuntimeScope | null,
  bound: PrincipalMutationRuntimeScope | null,
): boolean {
  if (!current || !bound) return current === bound;
  return (
    current.database === bound.database &&
    current.execSql === bound.execSql &&
    current.generation === bound.generation &&
    current.identityTrustDomain === bound.identityTrustDomain &&
    current.signingFingerprint === bound.signingFingerprint &&
    current.signingKeyPair === bound.signingKeyPair &&
    current.userId === bound.userId
  );
}

export type PrincipalMutationApi = ApiClient & PrincipalMutationRecoveryApi;
type MutationOverrides = JournaledPrincipalMutationMethods &
  PrincipalMutationRecoveryApi;

interface PrincipalMutationApiCustodyInput {
  readonly api: ApiClient;
  readonly readScope: () => PrincipalMutationRuntimeScope | null;
}

function mutationContext(
  input: PrincipalMutationApiCustodyInput,
  scope: PrincipalMutationRuntimeScope | null,
  organizationId: string,
) {
  if (!scope)
    throw new Error(
      "Principal mutations require an authenticated signing identity, a trusted API origin and durable local storage",
    );
  return {
    execSql: scope.execSql,
    signingKeyPair: scope.signingKeyPair,
    scope: {
      identityTrustDomain: scope.identityTrustDomain,
      organizationId,
      signingFingerprint: scope.signingFingerprint,
      userId: scope.userId,
    },
    stillCurrent: () => sameScope(input.readScope(), scope),
  };
}

/** Keep API methods bound to their real receiver and journal principal policy and group lifecycle writes. */
export function createPrincipalMutationApiCustody(
  input: PrincipalMutationApiCustodyInput,
) {
  let cached: {
    scope: PrincipalMutationRuntimeScope | null;
    api: PrincipalMutationApi;
  } | null = null;
  return {
    bind(): PrincipalMutationApi {
      const scope = input.readScope();
      if (cached && sameScope(scope, cached.scope)) return cached.api;
      const context = (organizationId: string) =>
        mutationContext(input, scope, organizationId);
      const read: PrincipalMutationRecoveryApi["readPendingPrincipalMutation"] =
        async (organizationId) =>
          scope
            ? readJournaledPrincipalMutation(context(organizationId))
            : null;
      const abandon: PrincipalMutationRecoveryApi["abandonPendingPrincipalMutation"] =
        async (organizationId, mutation, acknowledgeUnknownOutcome) =>
          abandonJournaledPrincipalMutation({
            ...context(organizationId),
            mutation,
            acknowledgeUnknownOutcome,
          });
      const methods = {
        ...createJournaledPrincipalMutations(input.api, context),
        discardUnreadablePrincipalMutation: async (
          organizationId,
          recordId,
          acknowledgeUnknownOutcome,
        ) =>
          discardUnreadableJournaledPrincipalMutation({
            ...context(organizationId),
            recordId,
            acknowledgeUnknownOutcome,
          }),
        readPendingPrincipalMutation: read,
        abandonPendingPrincipalMutation: abandon,
        recoverPendingPrincipalMutation: async (organizationId) => {
          await recoverJournaledPrincipalMutation({
            ...context(organizationId),
            submit: (mutation) =>
              dispatchAuthoredPrincipalMutation(
                input.api,
                organizationId,
                mutation,
                { reportErrors: false },
              ),
          });
        },
      } satisfies MutationOverrides;
      const api = bindMutationMethods(input.api, methods);
      cached = { scope, api };
      return api;
    },
  };
}

function bindMutationMethods(
  api: ApiClient,
  methods: MutationOverrides,
): PrincipalMutationApi {
  const boundMethods = new Map<
    PropertyKey,
    { source: unknown; bound: unknown }
  >();
  const bound = new Proxy(api, {
    get(target, property) {
      if (Object.hasOwn(methods, property))
        return Reflect.get(methods, property);
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const previous = boundMethods.get(property);
      if (previous?.source === value) return previous.bound;
      const bound = value.bind(target);
      boundMethods.set(property, { source: value, bound });
      return bound;
    },
  });
  // The checked overrides supply the signatures; verify their presence through
  // the reflective boundary before exposing the extended API to callers.
  if (!hasRecoveryMethods(bound))
    throw new Error("Principal mutation recovery methods are unavailable");
  return bound;
}

function hasRecoveryMethods(api: ApiClient): api is PrincipalMutationApi {
  return (
    typeof Reflect.get(api, "readPendingPrincipalMutation") === "function" &&
    typeof Reflect.get(api, "recoverPendingPrincipalMutation") === "function" &&
    typeof Reflect.get(api, "abandonPendingPrincipalMutation") === "function" &&
    typeof Reflect.get(api, "discardUnreadablePrincipalMutation") === "function"
  );
}
