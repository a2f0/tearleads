import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createRotatedAncestorFixture } from "../../../../test/helpers/ancestorRotationRecovery";
import { createContainerServer } from "../../../../test/helpers/containerMutationServer";
import { assertContainerKekPathCurrent } from "../../../data/documents/shared/containerKekCurrency";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { rekeyRemoteContainer } from "./rekeyRemote";

// #2340 finding 1. A rotation commits with the rekeys of every descendant above
// a directly granted container, so a writer granted only further down never
// waits on another device. The server names them; the SDK signs them against
// the path the batch will leave behind, and pins the batch as one.

test("a refused rotation is resubmitted carrying the descendants it strands", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("carried-rekeys-rotator");
  try {
    const owner = {
      ...fixture.input,
      execSql: database.execSql,
      persistVerificationCheckpoints: undefined,
    };
    const rootId = fixture.root.projection.containerId;
    // The grandchild is granted to someone else, so `child` sits above a grant.
    const server = createContainerServer(
      [
        fixture.root.projection,
        fixture.child.projection,
        fixture.grandchild.projection,
      ],
      { [rootId]: ["child"] },
    );
    const rotated = await rekeyRemoteContainer({
      ...owner,
      apiClient: server.apiClient,
      containerId: rootId,
      reportSecurityIncident: async () => {},
    });
    // One refusal, one retry, and the signed rotation itself was reused.
    expect(server.submissions).toEqual([[rootId], [rootId, "child"]]);
    expect(
      rotated?.response.containerRekeys?.map((rekey) => rekey.containerId),
    ).toEqual(["child"]);

    const child = server.project("child");
    if (!child) throw new Error("Expected the child projection");
    // Signed against the root epoch the same batch minted, not the served one.
    expect(() =>
      assertContainerKekPathCurrent(child.containerKeks),
    ).not.toThrow();
    expect(child.containerKeks.at(-1)?.parentContainerKeyEpochId).toBe(
      rotated?.plan.containerKeyEpochId,
    );
    // Both pins advanced, together.
    const pinned = await loadAccessManifestCheckpoint(
      database.execSql,
      "container",
      fixture.root.author.organizationId,
      "child",
    );
    expect(pinned?.manifestHash).toBe(child.path.at(-1)?.manifestHash);
    // The grandchild is its grantee's own to re-key, below a current parent.
    const grandchild = server.project("grandchild");
    if (!grandchild) throw new Error("Expected the grandchild projection");
    expect(grandchild.containerKeks.at(-1)?.parentContainerKeyEpochId).toBe(
      fixture.child.epochId,
    );
    // The rotator still reads retired epochs through the sealed keyrings.
    const keys = await unwrapContainerKekPath({
      ...owner,
      projection: grandchild,
      secretKey: fixture.root.secretKey,
    });
    expect(keys.get(fixture.grandchild.epochId)).toEqual(
      fixture.grandchild.key,
    );
  } finally {
    database.close();
  }
}, 120_000);

test("a chain of required descendants is signed parent-first on the batch's own path", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("carried-rekeys-chain");
  try {
    const owner = {
      ...fixture.input,
      execSql: database.execSql,
      persistVerificationCheckpoints: undefined,
    };
    const rootId = fixture.root.projection.containerId;
    const server = createContainerServer(
      [
        fixture.root.projection,
        fixture.child.projection,
        fixture.grandchild.projection,
      ],
      { [rootId]: ["child", "grandchild"] },
    );
    const rotated = await rekeyRemoteContainer({
      ...owner,
      apiClient: server.apiClient,
      containerId: rootId,
      reportSecurityIncident: async () => {},
    });
    expect(server.submissions.at(-1)).toEqual([rootId, "child", "grandchild"]);
    expect(rotated).not.toBeNull();
    const grandchild = server.project("grandchild");
    if (!grandchild) throw new Error("Expected the grandchild projection");
    expect(() =>
      assertContainerKekPathCurrent(grandchild.containerKeks),
    ).not.toThrow();
  } finally {
    database.close();
  }
}, 120_000);

test("a named container outside the rotated subtree is never signed for", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("carried-rekeys-foreign");
  try {
    const owner = {
      ...fixture.input,
      execSql: database.execSql,
      persistVerificationCheckpoints: undefined,
    };
    // A server naming the rotated container's own parent chain, not a
    // descendant: the hint is not an authority.
    const server = createContainerServer(
      [
        fixture.root.projection,
        fixture.child.projection,
        fixture.grandchild.projection,
      ],
      { child: [fixture.root.projection.containerId] },
    );
    await expect(
      rekeyRemoteContainer({
        ...owner,
        apiClient: server.apiClient,
        containerId: "child",
        reportSecurityIncident: async () => {},
      }),
    ).rejects.toThrow(/not below the rotated container/);
    expect(server.submissions).toEqual([["child"]]);
  } finally {
    database.close();
  }
}, 120_000);
