import { expect, test } from "bun:test";
import {
  createDocumentStore,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  getRosterProfileDocumentLocalId,
} from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";

const SIGNER = "personal-role-signer";
const USER_ID = "personal-role-user";
const PUBLIC_KEY = "personal-role-key";

async function seedContact(
  runtime: ContactsRuntime,
  localId: string,
  documentId: string,
  nickname: string,
  resetRemoteIdentity = false,
  rows: ReadonlyArray<Readonly<Record<string, string>>> = [],
) {
  const document = runtime.openDocumentStore({
    localId,
    initialDocumentKind: "contact",
  });
  await document.setStructuredFields(
    "contact",
    {
      encapsulationPublicKey: PUBLIC_KEY,
      isSelf: "1",
      userId: USER_ID,
      nickname,
    },
    { deferRemoteSync: true },
  );
  for (const row of rows) await document.addRow(row);
  const execSql = runtime.documents.infra.execSql;
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    localId,
  );
  if (!record) throw new Error(`Missing seeded contact ${localId}`);
  await defaultDocumentsPersistence.saveDocument(execSql, {
    ...record,
    documentId: resetRemoteIdentity ? null : documentId,
    ...(resetRemoteIdentity ? { recoveryDocumentId: documentId } : {}),
  });
}

for (const mode of [
  "provisioned",
  "discovered-alias",
  "reset-alias",
] as const) {
  test(`personal Me excludes a roster document without placement evidence: ${mode}`, async () => {
    const discoveredAlias = mode !== "provisioned";
    const resetRemoteIdentity = mode === "reset-alias";
    const base = await createRecoveryContactsRuntime({
      runtimeKey: `contacts-personal-role-${mode}`,
      signingFingerprint: SIGNER,
      userId: USER_ID,
    });
    const errors: unknown[] = [];
    const store = createContactsStore(base, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    try {
      const canonicalId = getSelfContactLocalId(SIGNER);
      const rosterId = getRosterProfileDocumentLocalId({
        organizationId: "personal-role-organization",
        userId: USER_ID,
      });
      const rosterRemoteId = await deriveStableDocumentId(rosterId);
      const profileId = discoveredAlias ? rosterRemoteId : rosterId;
      // Use the producer's actual identity derivation, not arbitrary remote IDs.
      // The mounted roster fixture separately exercises registration and HTTP.
      await seedContact(
        base,
        canonicalId,
        await deriveStableDocumentId(canonicalId),
        "",
        resetRemoteIdentity,
      );
      await seedContact(
        base,
        profileId,
        rosterRemoteId,
        "Registered profile",
        resetRemoteIdentity,
      );
      const runtime: ContactsRuntime = {
        ...base,
        documents: {
          ...base.documents,
          state: { ...base.documents.state, online: false },
        },
        listPendingWrites: async () => [],
        loadDocumentSummary: async (id) => {
          const record = await defaultDocumentsPersistence.loadDocument(
            base.documents.infra.execSql,
            id,
          );
          return record
            ? {
                id,
                containerId: record.containerId,
                documentId: record.documentId,
                documentKind: "contact",
                title: USER_ID,
                updatedAt: "2026-11-01T00:00:00.000Z",
              }
            : null;
        },
      };
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Contacts not ready",
      );
      const selected = await store.ensureSelfContact({
        localId: canonicalId,
        userId: USER_ID,
        encapsulationPublicKey: PUBLIC_KEY,
        deferRemoteSync: true,
      });
      const historiesPresent = await Promise.all(
        [canonicalId, profileId].map(
          async (id) =>
            (await defaultDocumentsPersistence.loadHistoryRestoreState(
              base.documents.infra.execSql,
              id,
            )) !== null,
        ),
      );
      expect({ selected, historiesPresent }).toEqual({
        selected: canonicalId,
        historiesPresent: [true, true],
      });
      expect(
        store.getSnapshot().entries.find((entry) => entry.id === profileId)
          ?.nickname,
      ).toBe("Registered profile");
      expect(errors).toEqual([]);
    } finally {
      store.updateRuntime({
        ...base,
        documents: {
          ...base.documents,
          infra: { ...base.documents.infra, dbStatus: "terminated" },
        },
      });
      base.close();
    }
  });
}

for (const mode of ["remote", "local", "reset"] as const) {
  test(`canonical Me reuses a ${mode} alias without rewriting its history`, async () => {
    const base = await createRecoveryContactsRuntime({
      runtimeKey: `personal-role-canonical-alias-${mode}`,
      signingFingerprint: SIGNER,
      userId: USER_ID,
    });
    const canonicalId = getSelfContactLocalId(SIGNER);
    const documentId = await deriveStableDocumentId(canonicalId);
    const alias = mode === "remote" ? documentId : `canonical-alias-${mode}`;
    const errors: unknown[] = [];
    const runtime: ContactsRuntime = {
      ...base,
      documents: {
        ...base.documents,
        state: { ...base.documents.state, online: false },
      },
    };
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    try {
      await seedContact(base, alias, documentId, "Retained", mode === "reset", [
        { recordType: "postalAddress", street: "12 Existing Street" },
        { recordType: "future-contact-field", opaqueValue: "Preserved" },
      ]);
      const execSql = base.documents.infra.execSql;
      const before = await defaultDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        alias,
      );
      expect(before).not.toBeNull();
      store.updateRuntime(runtime);
      expect(
        await store.ensureSelfContact({
          localId: canonicalId,
          userId: USER_ID,
          encapsulationPublicKey: PUBLIC_KEY,
          deferRemoteSync: true,
        }),
      ).toBe(alias);
      store.updateRuntime({
        ...runtime,
        documents: {
          ...runtime.documents,
          auth: {
            ...runtime.documents.auth,
            isAuthenticated: false,
            userId: null,
          },
        },
      });
      expect(
        await store.ensureSelfContact({
          localId: canonicalId,
          deferRemoteSync: true,
        }),
      ).toBe(alias);
      expect(
        await defaultDocumentsPersistence.loadDocument(execSql, canonicalId),
      ).toBeNull();
      expect(
        await defaultDocumentsPersistence.loadHistoryRestoreState(
          execSql,
          alias,
        ),
      ).toEqual(before);
      // A fresh store reads durable rows, not the registry's seeded snapshot.
      const reopened = createDocumentStore(alias, runtime.documents);
      expect(await reopened.ensureInitialized()).toBe(true);
      expect(reopened.getSnapshot()).toMatchObject({
        structuredFields: {
          nickname: "Retained",
          encapsulationPublicKey: PUBLIC_KEY,
          isSelf: "1",
          userId: USER_ID,
        },
        rows: [
          {
            fields: {
              recordType: "postalAddress",
              street: "12 Existing Street",
            },
          },
          {
            fields: {
              recordType: "future-contact-field",
              opaqueValue: "Preserved",
            },
          },
        ],
      });
      expect(errors).toEqual([]);
    } finally {
      store.updateRuntime({
        ...runtime,
        documents: {
          ...runtime.documents,
          infra: { ...runtime.documents.infra, dbStatus: "terminated" },
        },
      });
      base.close();
    }
  });
}

for (const resetRemoteIdentity of [false, true]) {
  test(`persisted identity outranks the canonical local alias: reset ${resetRemoteIdentity}`, async () => {
    const base = await createRecoveryContactsRuntime({
      runtimeKey: `personal-role-occupied-canonical-${resetRemoteIdentity}`,
      signingFingerprint: SIGNER,
      userId: USER_ID,
    });
    const canonicalId = getSelfContactLocalId(SIGNER);
    const documentId = await deriveStableDocumentId(canonicalId);
    const alias = "actual-canonical-document";
    const foreignId = await deriveStableDocumentId("unrelated-self-history");
    const errors: unknown[] = [];
    const runtime: ContactsRuntime = {
      ...base,
      documents: {
        ...base.documents,
        state: { ...base.documents.state, online: false },
      },
    };
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    try {
      await seedContact(
        base,
        canonicalId,
        foreignId,
        "Other history",
        resetRemoteIdentity,
      );
      await seedContact(
        base,
        alias,
        documentId,
        "Personal history",
        resetRemoteIdentity,
      );
      const histories = () =>
        Promise.all(
          [canonicalId, alias].map((id) =>
            defaultDocumentsPersistence.loadHistoryRestoreState(
              base.documents.infra.execSql,
              id,
            ),
          ),
        );
      const before = await histories();
      expect(before.every((history) => history !== null)).toBe(true);
      store.updateRuntime(runtime);
      expect(
        await store.ensureSelfContact({
          localId: canonicalId,
          userId: USER_ID,
          encapsulationPublicKey: PUBLIC_KEY,
          deferRemoteSync: true,
        }),
      ).toBe(alias);
      expect(await histories()).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      store.updateRuntime({
        ...runtime,
        documents: {
          ...runtime.documents,
          infra: { ...runtime.documents.infra, dbStatus: "terminated" },
        },
      });
      base.close();
    }
  });
}
