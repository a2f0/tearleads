import { expect, test } from "bun:test";
import {
  createMockRequestFailure,
  createNativeTestExecSql,
} from "@tearleads/test-utils";
import { createMetadataBindingFixture } from "../../../../test/helpers/containerMetadataBinding";
import { sharedReplacementBindingFixture } from "../../../../test/helpers/sharedReplacementBinding";
import { defaultContainerContentsPersistence as persistence } from "../containerPersistence";
import { renameContainerMetadataStateFromRuntime } from "../metadataPersistence";
import { rememberDestinationRole } from "./destinationRoleCache";

test("a restarted member store preserves queued metadata through a proven shared rehome", async () => {
  const database = createNativeTestExecSql();
  const { execSql } = database;
  try {
    const fixture = await createMetadataBindingFixture(execSql);
    const { input } = await sharedReplacementBindingFixture(execSql);
    const held = input.heldBinding;
    if (!held?.organizationId || !held.metadataDocumentId)
      throw new Error("Expected original binding");
    // Destination signature verification has its own tests. Seed its cache so
    // this test exercises proof admission, durable rebind, and queued updates.
    Object.assign(fixture.listed, {
      id: input.listed.id,
      organizationId: held.organizationId,
      metadataDocumentId: held.metadataDocumentId,
    });
    rememberDestinationRole(execSql, fixture.listed, {
      ...input.role,
      metadataDocumentId: held.metadataDocumentId,
    });
    Object.assign(fixture.state.runtime, {
      resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
      auth: {
        ...fixture.state.runtime.auth,
        userId: input.runtime.auth.userId,
      },
    });
    fixture.state.runtime.apiClient.getContainerReplacementAuthorizationsResult =
      input.runtime.apiClient.getContainerReplacementAuthorizationsResult;
    const original = await fixture.hydrate();
    if (!original) throw new Error("Expected held folder");
    const renamed = await renameContainerMetadataStateFromRuntime({
      metadataState: original,
      name: "Member's queued rename",
      persistence,
      runtime: fixture.state.runtime,
    });
    if (!renamed) throw new Error("Expected queued rename");
    const pending = await persistence.listPendingUpdates(
      execSql,
      fixture.listed.id,
    );
    expect(pending.length).toBeGreaterThan(0);
    fixture.state.containersById.clear();
    Object.assign(fixture.listed, input.listed, {
      metadataDocumentId: input.role.metadataDocumentId,
    });
    rememberDestinationRole(execSql, fixture.listed, input.role);

    const proofRead =
      fixture.state.runtime.apiClient
        .getContainerReplacementAuthorizationsResult;
    fixture.state.runtime.apiClient.getContainerReplacementAuthorizationsResult =
      async () => createMockRequestFailure({ message: "Network unavailable" });
    await expect(fixture.hydrate()).rejects.toMatchObject({
      name: "ProjectionDependencyUnavailableError",
    });
    expect(fixture.incidents).toHaveLength(0);
    expect(
      await persistence.loadHeldContainerBinding(execSql, fixture.listed.id),
    ).toMatchObject(held);
    fixture.state.runtime.apiClient.getContainerReplacementAuthorizationsResult =
      proofRead;
    const rehomed = await fixture.hydrate();
    expect(fixture.incidents).toHaveLength(0);
    expect(rehomed?.container).toMatchObject({
      metadataDocumentId: input.role.metadataDocumentId,
      organizationId: input.listed.organizationId,
      name: "Member's queued rename",
    });
    expect(
      await persistence.loadHeldContainerBinding(execSql, fixture.listed.id),
    ).toEqual({
      metadataDocumentId: input.role.metadataDocumentId,
      ordinary: true,
      organizationId: input.listed.organizationId,
    });
    expect(
      await persistence.listPendingUpdates(execSql, fixture.listed.id),
    ).toEqual(pending);
  } finally {
    database.close();
  }
});
