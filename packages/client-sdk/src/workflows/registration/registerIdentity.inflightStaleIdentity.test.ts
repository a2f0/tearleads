import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { getOrganizationProfileDocumentLocalId } from "../organizations/organizationProfile";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

function createClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

test("registration persists nothing when the identity goes stale in-flight", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-inflight-stale-identity",
  );
  let capturedRootContainerId: string | null = null;
  let capturedOrganizationId: string | null = null;
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      const request = {
        userId: args[0],
        organizationId: args[1],
        rootContainerId: args[2],
        signingPublicKey: Array.from(args[3]),
        encapsulationPublicKey: Array.from(args[4]),
        initialAdminGroup: args[5],
        initialMemberGroup: args[6],
        initialOrganizationPolicy: args[7],
        initialRootContainer: args[8],
        initialRootMetadataDocument: args[9],
        initialRosterProfileContainer: args[10],
        initialRosterProfileDocument: args[11],
        initialOrganizationMetadataContainer: args[12],
        initialOrganizationProfileDocument: args[13],
        initialSystemContainers: args[14],
      };
      capturedRootContainerId = request.rootContainerId;
      capturedOrganizationId = request.organizationId;
      return {
        ...(await respondToOrganizationProvisioning(request)),
        challenge: "a".repeat(64),
      };
    },
  };

  try {
    const client = createClient(execSql);
    // Genuinely hold the mutation queue the bootstrap persist serializes on,
    // so the registration reaches the queue and waits behind a mutation that
    // is still running — the window the in-mutex currency check guards.
    const workflowExecSql = createExecSql(client);
    let releaseHold!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let holdEntered!: () => void;
    const holdStarted = new Promise<void>((resolve) => {
      holdEntered = resolve;
    });
    const holding = runSerializedSqlMutation(workflowExecSql, async () => {
      holdEntered();
      await held;
    });
    await holdStarted;

    let identityCurrent = true;
    const registration = registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: client,
      documentProjectors: [],
      encapsulationKeyPair,
      isIdentityCurrent: () => identityCurrent,
      organizationProfileName: "Acme Corp",
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });

    // Wait for the remote registration to complete; the only remaining step
    // is the bootstrap persist, queued behind the held mutation.
    while (capturedOrganizationId === null) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    // The identity is replaced while the persist waits, then the queue frees.
    identityCurrent = false;
    releaseHold();
    await holding;

    // The remote organization exists, but no stale bootstrap row may reach
    // the local database the replacement identity now owns.
    await expect(registration).resolves.not.toBeNull();
    if (!capturedRootContainerId || !capturedOrganizationId) {
      throw new Error("Expected captured registration request");
    }
    await expect(
      sqlContainerContentsPersistence.containerExists(
        execSql,
        capturedRootContainerId,
      ),
    ).resolves.toBe(false);
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        "organization",
        capturedOrganizationId,
      ),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadDocument(
        execSql,
        getOrganizationProfileDocumentLocalId({
          organizationId: capturedOrganizationId,
        }),
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
