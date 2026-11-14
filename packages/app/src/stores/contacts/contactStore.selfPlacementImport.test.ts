import { expect, spyOn, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  getRosterProfileDocumentLocalId,
  type PendingWriteQueueItem,
  type ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import {
  item,
  operation,
} from "../../../test/helpers/explorer/syncPanelFixtures";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import * as ContactProjection from "./contactProjection";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";

const SELF: ResolvedUserIdentity = {
  encapsulationKeyFingerprint: "placement-self-kem-fingerprint",
  encapsulationPublicKey: "placement-self-key",
  signingKeyFingerprint: "placement-self-fingerprint",
  signingPublicKey: "placement-self-signing-key",
  userId: "self-user",
};

async function createImportFixture(
  profileFirst: boolean,
  status: PendingWriteQueueItem["status"],
) {
  const base = await createRecoveryContactsRuntime({
    runtimeKey: `self-placement-import-${profileFirst}-${status}`,
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const canonicalId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  const profileId = getRosterProfileDocumentLocalId({
    organizationId: "self-org",
    userId: SELF.userId,
  });
  for (const id of [canonicalId, profileId]) {
    await base.openDocumentStore({ localId: id }).setStructuredFields(
      "contact",
      {
        encapsulationPublicKey: SELF.encapsulationPublicKey,
        firstName: id === profileId ? "Registered profile" : "",
        isSelf: "1",
        userId: SELF.userId,
      },
      { deferRemoteSync: true },
    );
  }
  // Model only the public query result here. The dual-pane roster test covers
  // real registration, optimistic placement, and the actual API refusal.
  const runtime: ContactsRuntime = {
    ...base,
    listPendingWrites: async () => [
      item({
        localId: profileId,
        remoteId: null,
        status,
        operations: [
          operation({
            kind: "move",
            status: status === "blocked" ? "blocked" : "pending",
            lastError: status === "error" ? "Placement denied" : null,
          }),
        ],
      }),
    ],
  };
  const firstId = profileFirst ? profileId : canonicalId;
  const original = ContactProjection.loadProjectedContacts;
  let projectedIds: string[] = [];
  const observer = spyOn(
    ContactProjection,
    "loadProjectedContacts",
  ).mockImplementation(async (...args) => {
    const actual = await original(...args);
    const ordered = [
      ...actual.filter((entry) => entry.id === firstId),
      ...actual.filter((entry) => entry.id !== firstId),
    ];
    projectedIds = ordered.map((entry) => entry.id);
    return ordered;
  });
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async (userId) => (userId === SELF.userId ? SELF : null),
    logError: (message, cause) => errors.push({ message, cause }),
  });
  return {
    base,
    canonicalId,
    errors,
    firstId,
    observer,
    profileId,
    runtime,
    store,
    projectedIds: () => projectedIds,
  };
}

for (const profileFirst of [true, false]) {
  for (const status of ["pending", "blocked", "error"] as const) {
    test(`self import excludes ${status} placement with profile first ${profileFirst}`, async () => {
      const f = await createImportFixture(profileFirst, status);
      const persistence = defaultDocumentsPersistence;
      const execSql = f.runtime.documents.infra.execSql;
      const historiesPresent = () =>
        Promise.all(
          [f.canonicalId, f.profileId].map(
            async (id) =>
              (await persistence.loadHistoryRestoreState(execSql, id)) !== null,
          ),
        );
      try {
        f.store.updateRuntime(f.runtime);
        await waitForCondition(
          () => f.store.getSnapshot().ready,
          "Contacts not ready",
        );
        expect(f.projectedIds()[0]).toBe(f.firstId);
        expect(await historiesPresent()).toEqual([true, true]);
        const imported = await f.store.importVerifiedUser(SELF.userId);
        expect({
          imported,
          historiesPresent: await historiesPresent(),
        }).toEqual({
          imported: f.canonicalId,
          historiesPresent: [true, true],
        });
        expect(f.errors).toEqual([]);
      } finally {
        f.store.updateRuntime({
          ...f.runtime,
          documents: {
            ...f.runtime.documents,
            infra: { ...f.runtime.documents.infra, dbStatus: "terminated" },
          },
        });
        f.observer.mockRestore();
        f.base.close();
      }
    });
  }
}
