import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  createExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { getOrganizationProfileDocumentLocalId } from "../organizations/organizationProfile";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

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
      capturedOrganizationId = args[1];
      capturedRootContainerId = args[2];
      return respondToRegistration(args);
    },
  };

  let releaseHold = () => {};
  try {
    const client = execSqlClientFromExecSql(execSql);
    // Genuinely hold the mutation queue the bootstrap persist serializes on,
    // so the registration reaches the queue and waits behind a mutation that
    // is still running — the window the in-mutex currency check guards.
    const workflowExecSql = createExecSql(client);
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
    let identityProbes = 0;
    let persistQueued!: () => void;
    const persistEntersQueue = new Promise<void>((resolve) => {
      persistQueued = resolve;
    });
    const registration = registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: client,
      documentProjectors: [],
      encapsulationKeyPair,
      isIdentityCurrent: () => {
        identityProbes += 1;
        return identityCurrent;
      },
      onPersistQueued: persistQueued,
      organizationProfileName: "Acme Corp",
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });

    // The signal fires synchronously with the persist joining the mutation
    // queue, so past this await the persist is deterministically waiting
    // behind the held mutation — the window the in-mutex guard exists for.
    await persistEntersQueue;
    // The identity is replaced while the persist waits, then the queue frees.
    identityCurrent = false;
    releaseHold();
    await holding;
    await registration;
    expect(identityProbes).toBe(1);

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
    releaseHold();
    close();
  }
});

test("a mid-sequence identity switch rolls the whole bootstrap back", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-midsequence-stale-identity",
  );
  let capturedRootContainerId: string | null = null;
  let capturedOrganizationId: string | null = null;
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      capturedOrganizationId = args[1];
      capturedRootContainerId = args[2];
      return respondToRegistration(args);
    },
  };

  try {
    // The entry check (probe 1) passes, so every bootstrap write executes;
    // the pre-commit guard (probe 2) then finds the identity replaced. The
    // atomic transaction must leave NOTHING behind — the partial-persist
    // window a single entry check cannot close.
    let identityProbes = 0;
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      documentProjectors: [],
      encapsulationKeyPair,
      isIdentityCurrent: () => {
        identityProbes += 1;
        return identityProbes < 2;
      },
      organizationProfileName: "Acme Corp",
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    expect(response).not.toBeNull();
    expect(identityProbes).toBe(2);
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
