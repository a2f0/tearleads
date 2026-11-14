import { expect, mock, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifests,
  containers,
  documentContentKeyEpochs,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
  groups,
  organizationBilling,
  organizationReadModelHeads,
  organizationRosterEntries,
  organizations,
  principalHistoryProgress,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import type { RegistrationRequest } from "@tearleads/validators/request";
import { eq, inArray } from "drizzle-orm";
import { createRegistrationRequestBody } from "../../../test/helpers/api/submitRegistration";
import {
  seedTouchCounts,
  traceDocumentCreate,
} from "../../../test/helpers/documentCreateTouchFixture";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { registerUser } from "./registration";

async function fixture(full: boolean) {
  const user = createTestUser();
  return createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
    {
      includeOrganizationProfileDocument: full,
      includeRosterProfileDocument: full,
      includeTrashSystemContainer: full,
    },
  );
}

function initialUpdates(request: RegistrationRequest) {
  return [
    request.initialRootMetadataDocument.initialSync,
    request.initialRosterProfileContainer?.initialMetadataSync,
    request.initialRosterProfileDocument?.initialSync,
    request.initialOrganizationMetadataContainer.initialMetadataSync,
    request.initialOrganizationProfileDocument?.initialSync,
    ...(request.initialSystemContainers ?? []).map(
      (item) => item.initialMetadataSync,
    ),
  ].flatMap((sync) => sync?.outgoingUpdates ?? []);
}

for (const full of [false, true]) {
  test(`registration bounds statements and commits every initial update (full=${full})`, async () => {
    const request = await fixture(full);
    const counter = { statements: 0 };
    const { result, queries } = await traceDocumentCreate(() =>
      withDatabaseStatementCounter(counter, () =>
        registerUser(createServiceTestRuntime(), request),
      ),
    );
    // Two/six real seeds reuse only their immediate create evidence and touch
    // last, once. PostgreSQL counts two transaction-control statements too.
    console.info("create-seed-registration", {
      full,
      statements: counter.statements,
    });

    const updates = initialUpdates(request);
    expect(updates).toHaveLength(full ? 6 : 2);
    const stored = await db
      .select()
      .from(documentUpdates)
      .where(
        inArray(
          documentUpdates.id,
          updates.map(({ id }) => id),
        ),
      );
    expect(stored).toHaveLength(updates.length);
    for (const update of updates) {
      expect(stored.find(({ id }) => id === update.id)).toMatchObject({
        id: update.id,
        encryptedData: update.encryptedData,
        plaintextHash: update.plaintextHash,
      });
    }
    expect(result.organizationId).toBe(request.organizationId);
    expect(result.systemContainers).toHaveLength(full ? 1 : 0);
    const documentIds = updates.map((update) =>
      String(Reflect.get(update.writeHeader, "objectId")),
    );
    expect(new Set(documentIds).size).toBe(updates.length);
    expect(await seedTouchCounts(queries, documentIds)).toEqual(
      updates.map(() => 1),
    );
    expect(counter.statements).toBeLessThanOrEqual(
      (full ? 441 : 215) + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
    );
  });
}

test("a corrupt final registration update rolls back provisioning and permits a clean retry", async () => {
  const request = await fixture(true);
  const updates = initialUpdates(request);
  const finalUpdate =
    request.initialSystemContainers?.[0]?.initialMetadataSync
      .outgoingUpdates[0];
  if (!finalUpdate) throw new Error("Missing final update fixture");
  const validCiphertext = finalUpdate.encryptedData;
  finalUpdate.encryptedData = `${validCiphertext}tampered`;
  const runtime = createServiceTestRuntime();
  const publish = mock(async () => {});
  runtime.eventPublisher = { publish };
  await expect(registerUser(runtime, request)).rejects.toMatchObject({
    message: "Document update ciphertext hash mismatch",
    status: 400,
  });

  const principalIds = [
    request.organizationId,
    request.initialAdminGroup.groupId,
    request.initialMemberGroup.groupId,
  ];
  const documentIds = updates.map((update) => {
    const objectId: unknown = Reflect.get(update.writeHeader, "objectId");
    if (typeof objectId !== "string" || objectId.length === 0) {
      throw new Error("Missing document ID in initial update fixture");
    }
    return objectId;
  });
  const updateIds = updates.map(({ id }) => id);
  const remnants = await Promise.all([
    db.select().from(users).where(eq(users.id, request.userId)),
    db
      .select()
      .from(organizations)
      .where(eq(organizations.id, request.organizationId)),
    db
      .select()
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, request.organizationId)),
    db
      .select()
      .from(organizationRosterEntries)
      .where(
        eq(organizationRosterEntries.organizationId, request.organizationId),
      ),
    db
      .select()
      .from(organizationReadModelHeads)
      .where(
        eq(organizationReadModelHeads.organizationId, request.organizationId),
      ),
    db
      .select()
      .from(groups)
      .where(eq(groups.organizationId, request.organizationId)),
    db
      .select()
      .from(principalStates)
      .where(inArray(principalStates.principalId, principalIds)),
    db
      .select()
      .from(principalHistoryProgress)
      .where(inArray(principalHistoryProgress.principalId, principalIds)),
    db
      .select()
      .from(containers)
      .where(eq(containers.organizationId, request.organizationId)),
    db
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.organizationId, request.organizationId)),
    db
      .select()
      .from(accessEvents)
      .where(eq(accessEvents.organizationId, request.organizationId)),
    db.select().from(documents).where(inArray(documents.id, documentIds)),
    db
      .select()
      .from(documentUpdates)
      .where(inArray(documentUpdates.id, updateIds)),
    db
      .select()
      .from(documentContentKeyEpochs)
      .where(inArray(documentContentKeyEpochs.documentId, documentIds)),
    db
      .select()
      .from(documentContentWriteHeaders)
      .where(inArray(documentContentWriteHeaders.updateId, updateIds)),
  ]);
  for (const rows of remnants) expect(rows).toHaveLength(0);
  expect(publish).not.toHaveBeenCalled();
  const fingerprint = await toFingerprint(
    base64ToBytes(request.signingPublicKey),
  );
  expect(await runtime.keyValueStore.get(fingerprint)).toBeNull();
  expect(
    await runtime.keyValueStore.get(`challenge:${fingerprint}`),
  ).toBeNull();

  finalUpdate.encryptedData = validCiphertext;
  expect((await registerUser(runtime, request)).organizationId).toBe(
    request.organizationId,
  );
  expect(publish).toHaveBeenCalledTimes(1);
});
