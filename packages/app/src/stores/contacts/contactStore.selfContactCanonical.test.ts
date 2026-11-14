import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  type ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import { loadProjectedContacts } from "./contactProjection";
import { createContactsStore, getSelfContactLocalId } from "./contactStore";

const SELF: ResolvedUserIdentity = {
  encapsulationKeyFingerprint: "canonical-self-kem-fingerprint",
  encapsulationPublicKey: "canonical-self-kem-public-key",
  signingKeyFingerprint: "canonical-self-signing-fingerprint",
  signingPublicKey: "canonical-self-signing-public-key",
  userId: "1e99c653-9a13-498b-9952-2cf22c7f974c",
};

for (const first of ["bootstrap", "import"] as const) {
  test(`self ${first} first uses the same canonical contact identity`, async () => {
    const runtime = await createRecoveryContactsRuntime({
      runtimeKey: `canonical-self-${first}`,
      signingFingerprint: SELF.signingKeyFingerprint,
      userId: SELF.userId,
    });
    const errors: unknown[] = [];
    const store = createContactsStore(runtime, {
      resolveVerified: async (userId) => (userId === SELF.userId ? SELF : null),
      logError: (message, cause) => errors.push({ message, cause }),
    });
    const canonicalId = getSelfContactLocalId(SELF.signingKeyFingerprint);
    const bootstrap = () =>
      store.ensureSelfContact({
        deferRemoteSync: true,
        encapsulationPublicKey: SELF.encapsulationPublicKey,
        localId: canonicalId,
        userId: SELF.userId,
      });
    try {
      store.updateRuntime(runtime);
      // Drive the real producers in opposite orders; do not seed arbitrary
      // duplicate IDs. This proves local producer identity, not UI reachability
      // or remote protocol convergence, which require the dual-pane scenario.
      const firstId =
        first === "bootstrap"
          ? await bootstrap()
          : await store.importVerifiedUser(SELF.userId);
      const secondId =
        first === "bootstrap"
          ? await store.importVerifiedUser(SELF.userId)
          : await bootstrap();
      const entries = await loadProjectedContacts(
        runtime.documents.infra.execSql,
        runtime.documents.state.containerId ?? "",
      );
      expect(errors).toEqual([]);
      expect({
        firstId,
        secondId,
        ids: entries.map((entry) => entry.id),
      }).toEqual({
        firstId: canonicalId,
        secondId: canonicalId,
        ids: [canonicalId],
      });
      expect(entries[0]?.userId).toBe(SELF.userId);
      const record = await defaultDocumentsPersistence.loadDocument(
        runtime.documents.infra.execSql,
        canonicalId,
      );
      expect(record).not.toBeNull();
      expect(
        record?.documentId ??
          record?.recoveryDocumentId ??
          (await deriveStableDocumentId(record?.id ?? "missing")),
      ).toBe(await deriveStableDocumentId(canonicalId));
    } finally {
      runtime.close();
    }
  });
}

test("self import preserves a historical per-container same-user document", async () => {
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey: "canonical-self-historical-import",
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const containerId = runtime.documents.state.containerId;
  const historicalId = `contact_v1_${containerId}_${SELF.userId}`;
  const canonicalId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => SELF,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  try {
    await runtime
      .openDocumentStore({ localId: historicalId })
      .setStructuredFields(
        "contact",
        {
          encapsulationPublicKey: SELF.encapsulationPublicKey,
          isSelf: "1",
          userId: SELF.userId,
        },
        { deferRemoteSync: true },
      );
    const execSql = runtime.documents.infra.execSql;
    const before = await defaultDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      historicalId,
    );
    expect(before).not.toBeNull();
    store.updateRuntime(runtime);
    expect(await store.importVerifiedUser(SELF.userId)).toBe(canonicalId);
    expect(
      await defaultDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        historicalId,
      ),
    ).toEqual(before);
    expect(
      (await loadProjectedContacts(execSql, containerId ?? ""))
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([historicalId, canonicalId].sort());
    expect(errors).toEqual([]);
  } finally {
    store.updateRuntime({
      ...runtime,
      documents: {
        ...runtime.documents,
        infra: { ...runtime.documents.infra, dbStatus: "terminated" },
      },
    });
    runtime.close();
  }
});

test("a self identity lookup cannot outlive a logout and return to the same account", async () => {
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey: "canonical-self-expired-lookup",
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => null,
    getLocalUserIdentity: async () => {
      entered.resolve();
      await release.promise;
      return SELF;
    },
    logError: (message, cause) => errors.push({ message, cause }),
  });
  let ensuring: Promise<string | null> | undefined;
  try {
    const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
    store.updateRuntime(runtime);
    ensuring = store.ensureSelfContact({ localId, userId: SELF.userId });
    await Promise.race([
      entered.promise,
      ensuring.then(() => {
        throw new Error("Ensure settled before the held identity lookup");
      }),
    ]);
    store.updateRuntime({
      ...runtime,
      documents: {
        ...runtime.documents,
        auth: { ...runtime.documents.auth, isAuthenticated: false },
      },
    });
    store.updateRuntime(runtime);
    release.resolve();
    expect(await ensuring).toBeNull();
    expect(
      await defaultDocumentsPersistence.loadDocument(
        runtime.documents.infra.execSql,
        localId,
      ),
    ).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
    try {
      await ensuring;
    } finally {
      store.updateRuntime({
        ...runtime,
        documents: {
          ...runtime.documents,
          infra: { ...runtime.documents.infra, dbStatus: "terminated" },
        },
      });
      runtime.close();
    }
  }
});
