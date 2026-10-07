import { expect, test } from "bun:test";
import { ApiClient, type RequestFailure } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../test/helpers/principalMutationJournalFixture";
import { loadPrincipalMutationJournal } from "../data/persistence/principalMutationJournalPersistence";
import { principalMutationJournalScopeId } from "../data/principals/principalMutationJournal";
import type { PrincipalPolicyReadApi } from "../workflows/organizations/groupPolicyMutationContext";
import { clearRemoteSyncState } from "../workflows/sync/remoteReset";
import {
  createPrincipalMutationApiCustody,
  type PrincipalMutationRuntimeScope,
} from "./principalMutationApi";

test("runtime API custody resumes saved bytes after generation replacement and cache reset", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("principal-mutation-api");
  let runtime: PrincipalMutationRuntimeScope = {
    ...fixture.scope,
    database: {},
    generation: 1,
    execSql: sqlite.execSql,
    signingKeyPair: fixture.signingKeyPair,
  };
  const api = new ApiClient(fixture.scope.identityTrustDomain);
  const calls: unknown[] = [];
  let interrupted = true;
  api.commitOrganizationGroupPolicyResult = async function (
    organizationId,
    groupId,
    request,
    options,
  ) {
    expect(this).toBe(api);
    calls.push({ organizationId, groupId, request: structuredClone(request) });
    if (!interrupted) {
      expect(options?.reportErrors).toBe(false);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, data: fixture.response };
    }
    return {
      ok: false,
      kind: "outcome-unknown",
      status: null,
      message: "disconnected",
      method: "POST",
      path: "/fixture",
      statusText: "",
      report() {},
    } satisfies RequestFailure;
  };
  const custody = createPrincipalMutationApiCustody({
    api,
    readScope: () => runtime,
  });
  try {
    const first = custody.bind();
    expect(custody.bind()).toBe(first);
    first.setAuthToken("fixture-token");
    await expect(
      first.commitOrganizationGroupPolicyResult(
        fixture.scope.organizationId,
        fixture.mutation.groupId,
        fixture.mutation.request,
      ),
    ).rejects.toThrow("may have committed");
    expect(calls).toHaveLength(1);
    const scopeId = await principalMutationJournalScopeId(fixture.scope);
    const pending = await loadPrincipalMutationJournal(sqlite.execSql, scopeId);
    expect(pending).not.toBeNull();
    await clearRemoteSyncState(sqlite.execSql, {
      organizationId: fixture.scope.organizationId,
    });
    expect(await loadPrincipalMutationJournal(sqlite.execSql, scopeId)).toEqual(
      pending,
    );
    runtime = { ...runtime, generation: 2 };
    await expect(
      first.commitOrganizationGroupPolicyResult(
        fixture.scope.organizationId,
        fixture.mutation.groupId,
        fixture.mutation.request,
      ),
    ).rejects.toThrow("generation expired");
    expect(calls).toHaveLength(1);
    const fresh: PrincipalPolicyReadApi = custody.bind();
    expect(fresh).not.toBe(first);
    interrupted = false;
    if (!fresh.recoverPendingPrincipalMutation)
      throw new Error("Missing runtime journal recovery");
    await fresh.recoverPendingPrincipalMutation(fixture.scope.organizationId);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(
      await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("runtime policy writes fail before HTTP when their trusted journal scope is unavailable", async () => {
  const fixture = await principalMutationJournalFixture();
  const api = new ApiClient(fixture.scope.identityTrustDomain);
  let calls = 0;
  api.commitOrganizationGroupPolicyResult = async () => {
    calls += 1;
    return { ok: true, data: fixture.response };
  };
  const bound = createPrincipalMutationApiCustody({
    api,
    readScope: () => null,
  }).bind();
  await expect(
    bound.commitOrganizationGroupPolicyResult(
      fixture.scope.organizationId,
      fixture.mutation.groupId,
      fixture.mutation.request,
    ),
  ).rejects.toThrow("trusted API origin");
  expect(calls).toBe(0);
});
