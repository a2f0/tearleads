import { expect, mock, test } from "bun:test";
import {
  db,
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
    const result = await withDatabaseStatementCounter(counter, () =>
      registerUser(createServiceTestRuntime(), request),
    );
    // PGlite: 646 / 1,570 before, 536 / 1,274 after batching, 471 / 1,088 by
    // the database efficiency audit, 393 / 883 once signer rows are read once
    // per transaction and fresh manifests skip their no-op projection deletes.
    // Batched current payload/envelopes remove another 20 / 44 statements.
    // 373 / 841 on PGlite and 365 / 827 on SQLite, then 370 / 838 and
    // 362 / 824 once the principal state signer read joined the transaction's
    // signer memo; Postgres also counts its two transaction controls. Then
    // 344 / 786 (PGlite), 336 / 772 (SQLite), and 346 / 788 (Postgres) once
    // inserts verify their RETURNING rows and the metadata reservation reads
    // its evidence in one statement. The audit's sync unit (KEK targets once
    // per sync, held locks and manifest bundles reused, the seed's pull page
    // skipped) then took them to 304 / 655, 299 / 646,
    // and 306 / 657. Hash acknowledgements skip each created container's KEK
    // history read: 303 / 652, 298 / 643, and 305 / 654. Deriving built-in
    // grants and dropping the principal epoch-key copy then took them to
    // 298 / 647, 293 / 638, and 300 / 649. Memoizing current principal
    // states and organization descriptors under their locks then took them
    // to 288 / 637, 283 / 628, and 290 / 639.
    expect(counter.statements).toBeLessThanOrEqual(full ? 639 : 290);
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
