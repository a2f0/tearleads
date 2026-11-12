import { expect, test } from "bun:test";
import {
  type AuthoredPrincipalMutation,
  createMemoryBlobStore,
  PrincipalMutationOutcomeUnknownError,
  readJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
  Tearleads,
  type TearleadsOptions,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { unexpectedSecurityIncidents } from "../../../test/helpers/unexpectedSecurityIncidents";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";
import { readBackupDatabase } from "./localBackupDatabase";
import { decodeBackupFile, encodeBackupFile } from "./localBackupFormat";

async function attemptProvisioning(
  input: { identity: TearleadsOptions["identity"]; userId: string },
  execSql: ExecSql,
  requests: CreateOrganizationRequest[],
) {
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    blobStore: createMemoryBlobStore(),
    database: {
      client: {
        async exec({ sql, bind, rowMode }) {
          return {
            rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
          };
        },
      },
    },
    identity: input.identity,
    identityProvisioning: "manual",
    online: false,
    logger: { log() {}, logError() {} },
  });
  try {
    const client: unknown = Reflect.get(sdk, "apiClient");
    if (!client || typeof client !== "object")
      throw new Error("Missing API client");
    const disconnected = new Error("Disconnected after dispatch");
    Reflect.set(
      client,
      "createOrganizationResult",
      async (request: CreateOrganizationRequest) => {
        requests.push(request);
        throw disconnected;
      },
    );
    sdk.session.setContext({ userId: input.userId });
    // Calls buildOrganizationProvisioningArtifacts and the real durable-attempt
    // serializer; the disconnected transport retains the complete saved row.
    await expect(
      sdk.session.createOrganization({
        organizationProfileName: "Backup round trip",
        rosterProfileNickname: "Founder",
      }),
    ).rejects.toBe(disconnected);
  } finally {
    sdk.dispose();
  }
}

async function createPendingProvisioning(execSql: ExecSql) {
  const requests: CreateOrganizationRequest[] = [];
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const input = {
    userId: crypto.randomUUID(),
    identity: {
      signingKeyPair,
      signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
    },
  };
  await attemptProvisioning(input, execSql, requests);
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (!request) throw new Error("Provisioning never reached the transport");
  return { input, request, requests };
}

async function encryptedRoundTrip(source: ExecSql, target: ExecSql) {
  const blobStore = createMemoryBlobStore();
  const payload = await createBackupPayload({
    blobStore,
    execSql: source,
    databaseId: null,
    signingFingerprint: null,
  });
  const text = await encodeBackupFile({
    payload,
    password: "artifact-round-trip",
  });
  await restoreBackupPayload({
    blobStore,
    execSql: target,
    payload: await decodeBackupFile({ text, password: "artifact-round-trip" }),
    securityIncidents: unexpectedSecurityIncidents,
  });
}

test("real provisioning artifacts survive encrypted backup and durable retry", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    const { input, request, requests } = await createPendingProvisioning(
      source.execSql,
    );
    const before = await readBackupDatabase({ execSql: source.execSql });
    const rows = before.tables.find(
      (table) => table.name === "organization_provisioning_attempts",
    )?.rows;
    expect(rows).toHaveLength(1);
    const { identity_bundle_format: format, serialized_artifacts: artifacts } =
      rows?.[0] ?? {};
    expect(format).toBe(1);
    expect(artifacts).toContain("__tearleadsProvisioningBytes");
    await encryptedRoundTrip(source.execSql, target.execSql);
    const restored = await readBackupDatabase({ execSql: target.execSql });
    expect(
      restored.tables.find(
        (table) => table.name === "organization_provisioning_attempts",
      )?.rows,
    ).toHaveLength(1);
    expect(restored).toEqual(before);
    await attemptProvisioning(input, target.execSql, requests);
    expect(requests).toEqual([request, request]);
    expect(await readBackupDatabase({ execSql: target.execSql })).toEqual(
      before,
    );
  } finally {
    source.close();
    target.close();
  }
});

test("real compound journal output survives encrypted backup and authentication", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    const { input, request } = await createPendingProvisioning(source.execSql);
    // Use all three independently signed builder policies, not shape-only
    // projections. The real journal signs, serializes and persists this body.
    const mutation: AuthoredPrincipalMutation = {
      kind: "compound",
      groupId: request.initialAdminGroup.groupId,
      request: {
        groupPolicy: request.initialAdminGroup.initialGroupPolicy,
        memberPolicy: request.initialMemberGroup.initialGroupPolicy,
        organizationPolicy: request.initialOrganizationPolicy,
      },
    };
    const context = {
      scope: {
        identityTrustDomain: "https://api.example.test",
        organizationId: request.organizationId,
        userId: input.userId,
        signingFingerprint: input.identity.signingFingerprint,
      },
      signingKeyPair: input.identity.signingKeyPair,
      stillCurrent: () => true,
    };
    const submitted: AuthoredPrincipalMutation[] = [];
    await expect(
      submitJournaledPrincipalMutation({
        ...context,
        execSql: source.execSql,
        mutation,
        async submit(value) {
          submitted.push(value);
          throw new Error("Disconnected after dispatch");
        },
      }),
    ).rejects.toBeInstanceOf(PrincipalMutationOutcomeUnknownError);
    expect(submitted).toEqual([mutation]);
    const before = await readBackupDatabase({ execSql: source.execSql });
    const rows = before.tables.find(
      (table) => table.name === "principal_mutation_journal",
    )?.rows;
    expect(rows).toHaveLength(1);
    const { identity_bundle_format: format, serialized_request: serialized } =
      rows?.[0] ?? {};
    expect(format).toBe(1);
    expect(JSON.parse(String(serialized))).toEqual(mutation);
    await encryptedRoundTrip(source.execSql, target.execSql);
    const restored = await readBackupDatabase({ execSql: target.execSql });
    expect(
      restored.tables.find(
        (table) => table.name === "principal_mutation_journal",
      )?.rows,
    ).toHaveLength(1);
    expect(restored).toEqual(before);
    expect(
      await readJournaledPrincipalMutation({
        ...context,
        execSql: target.execSql,
      }),
    ).toEqual(mutation);
    expect(await readBackupDatabase({ execSql: target.execSql })).toEqual(
      before,
    );
  } finally {
    source.close();
    target.close();
  }
});
