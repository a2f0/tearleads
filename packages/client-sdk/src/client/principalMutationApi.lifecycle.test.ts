import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../test/helpers/principalMutationJournalFixture";
import { clearRemoteSyncState } from "../workflows/sync/remoteReset";
import { createPrincipalMutationApiCustody } from "./principalMutationApi";

for (const nullable of [false, true]) {
  test.each(["group-create", "group-delete", "organization"] as const)(
    `runtime ${nullable ? "nullable" : "result"} %s replays saved HTTP bytes after interruption and generation replacement`,
    async (kind) => {
      const fixture = await principalMutationJournalFixture();
      const sqlite = await createTestExecSql("principal-lifecycle-journal");
      const organizationId = fixture.scope.organizationId;
      const { groupId, request } = fixture.mutation;
      const createRequest = {
        groupId,
        initialGroupPolicy: request.groupPolicy,
        organizationPolicy: request.organizationPolicy,
      };
      const deletion = { organizationPolicy: request.organizationPolicy };
      const state = fixture.response.groupPolicy.currentState;
      const creation = {
        group: {
          groupId,
          organizationId,
          createdAt: state.createdAt,
          isBuiltin: false,
          currentState: {
            keyEpoch: state.keyEpoch,
            keyFingerprint: state.keyFingerprint,
            memberCount: state.memberCount,
            stateHash: state.stateHash,
            version: state.version,
          },
        },
        organizationPolicy: fixture.response.organizationPolicy,
      };
      const deleted = {
        deleted: true,
        groupId,
        organizationId,
        organizationPolicy: fixture.response.organizationPolicy,
      };
      const response =
        kind === "group-create"
          ? creation
          : kind === "group-delete"
            ? deleted
            : fixture.response.organizationPolicy;
      const invalid = structuredClone(response);
      if ("group" in invalid) invalid.group.groupId = crypto.randomUUID();
      else if ("groupId" in invalid) invalid.groupId = crypto.randomUUID();
      else invalid.currentState.stateHash = "substituted-state-hash";
      const invalidReceipts = [invalid];
      if ("group" in response) {
        for (const field of ["memberCount", "keyEpoch"] as const) {
          const changed = structuredClone(response);
          changed.group.currentState[field] += 1;
          invalidReceipts.push(changed);
        }
        const builtin = structuredClone(response);
        builtin.group.isBuiltin = true;
        invalidReceipts.push(builtin);
      } else if ("groupId" in response) {
        const changed = structuredClone(response);
        changed.organizationId = crypto.randomUUID();
        invalidReceipts.push(changed);
      }
      const expectedBody = JSON.stringify(
        kind === "group-create"
          ? createRequest
          : kind === "group-delete"
            ? deletion
            : request.organizationPolicy,
      );
      const expectedPath =
        kind === "organization"
          ? `/principals/organization/${organizationId}/policy`
          : `/organizations/${organizationId}/groups${kind === "group-delete" ? `/${groupId}` : ""}`;
      const committed = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const bodies: string[] = [];
      let observedReceipt = response;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          expect(new URL(request.url).pathname).toBe(expectedPath);
          bodies.push(await request.text());
          if (bodies.length === 1) {
            committed.resolve();
            await release.promise;
          }
          return Response.json(
            bodies.length === 1 ? response : observedReceipt,
          );
        },
      });
      const api = new ApiClient(server.url.origin);
      let scope = {
        ...fixture.scope,
        identityTrustDomain: server.url.origin,
        database: {},
        generation: 1,
        execSql: sqlite.execSql,
        signingKeyPair: fixture.signingKeyPair,
      };
      const custody = createPrincipalMutationApiCustody({
        api,
        readScope: () => scope,
      });
      const first = custody.bind();
      const controller = new AbortController();
      const options = { signal: controller.signal, reportErrors: false };
      const create = nullable
        ? first.createOrganizationGroup
        : first.createOrganizationGroupResult;
      const remove = nullable
        ? first.deleteOrganizationGroup
        : first.deleteOrganizationGroupResult;
      const put = nullable
        ? first.putPrincipalPolicy
        : first.putPrincipalPolicyResult;
      const sent =
        kind === "group-create"
          ? create(organizationId, createRequest, options)
          : kind === "group-delete"
            ? remove(organizationId, groupId, deletion, options)
            : put(
                "organization",
                organizationId,
                request.organizationPolicy,
                options,
              );
      // Attach rejection handling before aborting the in-flight request.
      const outcome = sent.catch((error: unknown) => error);
      try {
        await committed.promise;
        expect(
          await first.readPendingPrincipalMutation(organizationId),
        ).toMatchObject({ kind });
        controller.abort();
        expect(await outcome).toBeInstanceOf(Error);
        release.resolve();
        const saved = await first.readPendingPrincipalMutation(organizationId);
        await clearRemoteSyncState(sqlite.execSql, { organizationId });
        scope = { ...scope, generation: 2 };
        const fresh = custody.bind();
        expect(
          await fresh.readPendingPrincipalMutation(organizationId),
        ).toEqual(saved);
        await expect(
          fresh.commitOrganizationGroupPolicyResult(
            organizationId,
            groupId,
            request,
          ),
        ).rejects.toThrow();
        expect(bodies).toHaveLength(1);
        for (const invalidReceipt of invalidReceipts) {
          observedReceipt = invalidReceipt;
          await expect(
            fresh.recoverPendingPrincipalMutation(organizationId),
          ).rejects.toThrow();
          expect(
            await fresh.readPendingPrincipalMutation(organizationId),
          ).toEqual(saved);
        }
        observedReceipt = response;
        await fresh.recoverPendingPrincipalMutation(organizationId);
        expect(
          await fresh.readPendingPrincipalMutation(organizationId),
        ).toBeNull();
        expect(bodies).toHaveLength(invalidReceipts.length + 2);
        const firstBody = bodies[0];
        if (firstBody === undefined) throw new Error("Expected submitted body");
        for (const body of bodies) expect(body).toBe(firstBody);
        expect(JSON.parse(bodies[0] ?? "null")).toEqual(
          JSON.parse(expectedBody),
        );
      } finally {
        controller.abort();
        release.resolve();
        await outcome;
        await server.stop(true);
        sqlite.close();
      }
    },
    15_000,
  );
}
