import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import { createContactsStore, getSelfContactLocalId } from "./contactStore";

const FINGERPRINT = "recovery-alias-self-signing-fingerprint";
const USER_ID = "8f0c1d4e-2b7a-4c39-9e51-6a3d2f1b0c77";
const ALIAS_ID = "self-recovery-alias";
const ELSEWHERE = "elsewhere-container";

test("an out-of-place recovery-only Me alias refuses a second canonical birth", async () => {
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey: "self-recovery-alias-out-of-place",
    signingFingerprint: FINGERPRINT,
    userId: USER_ID,
  });
  const execSql = runtime.documents.infra.execSql;
  const canonicalId = getSelfContactLocalId(FINGERPRINT);
  const documentId = await deriveStableDocumentId(canonicalId);
  try {
    const { documents } = runtime;
    // The alias was born outside the Contacts container (e.g. a profile).
    const alias = openDocumentStore(
      documents.state.domainScope,
      ALIAS_ID,
      { ...documents, state: { ...documents.state, containerId: ELSEWHERE } },
      documentId,
      "",
      "contact",
      { initialStructuredFields: { firstName: "Preserved" } },
    );
    expect(await alias.ensureInitialized()).toBe(true);
    // Reader coverage for already-admitted metadata: a reset left D only as
    // recovery identity. Ordinary saveDocument clears recovery on binding.
    await execSql(
      "UPDATE documents SET document_id = NULL, recovery_document_id = :recovery WHERE local_id = :localId",
      { ":recovery": documentId, ":localId": ALIAS_ID },
    );
    const before = await defaultDocumentsPersistence.loadDocument(
      execSql,
      ALIAS_ID,
    );
    expect(before).toMatchObject({
      containerId: ELSEWHERE,
      documentId: null,
      recoveryDocumentId: documentId,
    });
    // Seed before the store subscribes, so the alias is never a tracked entry.
    const errors: unknown[] = [];
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    store.updateRuntime(runtime);

    expect(
      await store.ensureSelfContact({
        deferRemoteSync: true,
        localId: canonicalId,
      }),
    ).toBeNull();
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, canonicalId),
    ).toBeNull();
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, ALIAS_ID),
    ).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});
