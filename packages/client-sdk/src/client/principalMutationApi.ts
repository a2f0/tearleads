import type { ApiClient } from "@tearleads/api-client";
import type { SigningKeyPair } from "@tearleads/crypto";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  abandonJournaledPrincipalMutation,
  discardUnreadableJournaledPrincipalMutation,
  type PrincipalMutationRecoveryApi,
  readJournaledPrincipalMutation,
} from "../workflows/organizations/principalMutationJournalManagement";
import {
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "../workflows/organizations/principalMutationJournalSession";

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
  bound: PrincipalMutationRuntimeScope,
): boolean {
  return (
    current?.database === bound.database &&
    current.execSql === bound.execSql &&
    current.generation === bound.generation &&
    current.identityTrustDomain === bound.identityTrustDomain &&
    current.signingFingerprint === bound.signingFingerprint &&
    current.signingKeyPair === bound.signingKeyPair &&
    current.userId === bound.userId
  );
}

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

/** Keep API methods bound to their real receiver and journal only policy writes. */
export function createPrincipalMutationApiCustody(
  input: PrincipalMutationApiCustodyInput,
) {
  let cached: { scope: PrincipalMutationRuntimeScope; api: ApiClient } | null =
    null;
  return {
    bind(): ApiClient {
      const scope = input.readScope();
      if (scope && cached && sameScope(scope, cached.scope)) return cached.api;
      const context = (organizationId: string) =>
        mutationContext(input, scope, organizationId);
      const commit: ApiClient["commitOrganizationGroupPolicyResult"] = async (
        organizationId,
        groupId,
        request,
        options,
      ) =>
        submitJournaledPrincipalMutation({
          ...context(organizationId),
          mutation: { groupId, request },
          submit: (mutation) =>
            input.api.commitOrganizationGroupPolicyResult(
              organizationId,
              mutation.groupId,
              mutation.request,
              options,
            ),
        });
      const read: PrincipalMutationRecoveryApi["readPendingPrincipalMutation"] =
        async (organizationId) =>
          readJournaledPrincipalMutation(context(organizationId));
      const abandon: PrincipalMutationRecoveryApi["abandonPendingPrincipalMutation"] =
        async (organizationId, mutation, acknowledgeUnknownOutcome) =>
          abandonJournaledPrincipalMutation({
            ...context(organizationId),
            mutation,
            acknowledgeUnknownOutcome,
          });
      const methods = new Map<PropertyKey, unknown>([
        [
          "discardUnreadablePrincipalMutation",
          async (
            organizationId: string,
            recordId: string,
            acknowledgeUnknownOutcome: true,
          ) =>
            discardUnreadableJournaledPrincipalMutation({
              ...context(organizationId),
              recordId,
              acknowledgeUnknownOutcome,
            }),
        ],
        ["readPendingPrincipalMutation", read],
        ["abandonPendingPrincipalMutation", abandon],
        ["commitOrganizationGroupPolicyResult", commit],
        [
          "commitOrganizationGroupPolicy",
          async (
            ...args: Parameters<ApiClient["commitOrganizationGroupPolicy"]>
          ) => {
            const result = await commit(...args);
            return result.ok ? result.data : null;
          },
        ],
        [
          "recoverPendingPrincipalMutation",
          async (organizationId: string) => {
            await recoverJournaledPrincipalMutation({
              ...context(organizationId),
              submit: (mutation) =>
                input.api.commitOrganizationGroupPolicyResult(
                  organizationId,
                  mutation.groupId,
                  mutation.request,
                  { signal: AbortSignal.timeout(15_000), reportErrors: false },
                ),
            });
          },
        ],
      ]);
      const api = bindMutationMethods(input.api, methods);
      cached = scope ? { scope, api } : null;
      return api;
    },
  };
}

function bindMutationMethods(
  api: ApiClient,
  methods: ReadonlyMap<PropertyKey, unknown>,
): ApiClient {
  const boundMethods = new Map<
    PropertyKey,
    { source: unknown; bound: unknown }
  >();
  return new Proxy(api, {
    get(target, property) {
      if (methods.has(property)) return methods.get(property);
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const previous = boundMethods.get(property);
      if (previous?.source === value) return previous.bound;
      const bound = value.bind(target);
      boundMethods.set(property, { source: value, bound });
      return bound;
    },
  });
}
