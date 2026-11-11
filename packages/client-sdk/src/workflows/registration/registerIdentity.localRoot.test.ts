import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { hydrateStoredContainerState } from "../container-contents/storedContainerState";
import { bootstrapRootContainer } from "./bootstrapRootContainer";
import { registerIdentity } from "./registerIdentity";

test("registration binds a device-first root with locally hydrated metadata", async () => {
  const { execSql, close } = await createTestExecSql("registration-local-root");
  try {
    const { containerId } = await bootstrapRootContainer(execSql);
    const placeholder =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        containerId,
      );
    if (!placeholder) throw new Error("Expected device-first root");
    const local = await hydrateStoredContainerState({
      execSql,
      persistence: sqlContainerContentsPersistence,
      storedContainer: placeholder,
    });
    expect(local.record).toMatchObject({
      accessStateHash: null,
      documentId: null,
    });
    expect(local.record.metadataUpdates.length).toBeGreaterThan(0);
    expect(local.container.organizationId).toBe("");

    const response = await registerIdentity({
      identityTrustDomain: "https://api.example.test",
      apiClient: {
        registerUser: (...args) => respondToRegistration(args),
      },
      containerId,
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingKeyPair: generateSigningSeedAndKeyPair(),
      pinLocalUserIdentity: async () => undefined,
    });
    if (!response) throw new Error("Expected acknowledged registration");
    const registered =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        containerId,
      );
    expect(registered?.container).toMatchObject({
      organizationId: response.organizationId,
      metadataDocumentId: response.rootMetadataDocumentId,
    });
    expect(registered?.record).toMatchObject({
      documentId: response.rootMetadataDocumentId,
      accessStateHash: response.rootMetadataAccessStateHash,
    });
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        containerId,
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});
