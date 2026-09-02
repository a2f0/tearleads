import { expect, test } from "bun:test";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import type {
  DocumentSyncApi,
  DocumentSyncPlan,
} from "../../data/documents/shared/types";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";
import { submitDocumentSyncAttemptIfAllowed } from "./syncFailures";

const POLICY_BUNDLE = {} as PrincipalPolicyBundleResponse;
const PLAN = {
  documentId: "document-1",
  organizationId: "organization-1",
  request: {
    containerRekeys: [{} as ContainerMutationRequest],
    outgoingUpdates: [],
  },
} as unknown as DocumentSyncPlan;

test("sync caches stale-policy repair bundles before replanning container rekeys", async () => {
  const cached: unknown[] = [];
  const warmer = Object.assign(async () => undefined, {
    cacheBundles: async (input: unknown) => {
      cached.push(input);
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;
  const apiClient: DocumentSyncApi = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => {
      throw new Error("result-returning sync should be used");
    },
    syncDocumentResult: async () => ({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      message: "Principal policy is stale",
      ok: false,
      report: () => undefined,
      stalePrincipalPolicies: [POLICY_BUNDLE],
      status: 409,
    }),
  };

  const result = await submitDocumentSyncAttemptIfAllowed({
    apiClient,
    attempt: 1,
    documentId: PLAN.documentId,
    maxAttempts: 3,
    pendingUpdates: [],
    plan: PLAN,
    warmReferencedPrincipalPolicies: warmer,
  });

  expect(result).toBe("retry");
  expect(cached).toEqual([
    {
      bundles: [POLICY_BUNDLE],
      organizationId: PLAN.organizationId,
      stillCurrent: undefined,
    },
  ]);
});

test("sync rejects repair bundles outside stale inline-rekey failures", async () => {
  const cached: unknown[] = [];
  const warmer = Object.assign(async () => undefined, {
    cacheBundles: async (input: unknown) => {
      cached.push(input);
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;
  let code: string = DOCUMENT_SYNC_ERROR_CODES.conflict;
  const apiClient: DocumentSyncApi = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => {
      throw new Error("result-returning sync should be used");
    },
    syncDocumentResult: async () => ({
      code,
      message: "Conflict",
      ok: false,
      report: () => undefined,
      stalePrincipalPolicies: [POLICY_BUNDLE],
      status: 409,
    }),
  };

  const terminal = await submitDocumentSyncAttemptIfAllowed({
    apiClient,
    attempt: 1,
    documentId: PLAN.documentId,
    maxAttempts: 3,
    pendingUpdates: [],
    plan: PLAN,
    warmReferencedPrincipalPolicies: warmer,
  });
  code = DOCUMENT_SYNC_ERROR_CODES.stateStale;
  const withoutRekeys = await submitDocumentSyncAttemptIfAllowed({
    apiClient,
    attempt: 1,
    documentId: PLAN.documentId,
    maxAttempts: 3,
    pendingUpdates: [],
    plan: {
      ...PLAN,
      request: { ...PLAN.request, containerRekeys: undefined },
    },
    warmReferencedPrincipalPolicies: warmer,
  });

  expect(terminal).toBe("stop");
  expect(withoutRekeys).toBe("retry");
  expect(cached).toEqual([]);
});
