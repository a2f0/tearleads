import { expect, spyOn, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  Tearleads,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { resolveProfileDocumentIdentity } from "./profileDocumentIdentity";

const containerId = "profile-identity-container";
const preferredLocalId = "org-profile:identity-org:identity-user";

async function fixture() {
  const database = await createTestExecSql("profile-identity");
  const sdk = new Tearleads({
    database: { execSql: database.execSql, id: "profile-identity-db" },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  });
  await defaultDocumentsPersistence.ensureSchema(database.execSql);
  return {
    database,
    sdk,
    input: {
      containerId,
      documents: sdk.documents,
      preferredLocalId,
      stillCurrent: () => true,
    },
    close: () => {
      sdk.dispose();
      database.close();
    },
    seed: async (localId: string, documentId: string) => {
      const store = sdk.documents.open({
        containerId,
        documentId,
        localId,
        initialDocumentKind: "contact",
        initialStructuredFields: { firstName: "Preserved" },
      });
      expect(await store.ensureInitialized()).toBe(true);
      return store;
    },
  };
}

test("an explicit profile pointer excludes an occupied preferred local key", async () => {
  const h = await fixture();
  try {
    const wanted = await deriveStableDocumentId("wanted-profile");
    await h.seed(
      preferredLocalId,
      await deriveStableDocumentId("other-profile"),
    );
    await h.seed(wanted, wanted);
    const before = await defaultDocumentsPersistence.loadDocument(
      h.database.execSql,
      preferredLocalId,
    );
    expect(
      await resolveProfileDocumentIdentity({ ...h.input, documentId: wanted }),
    ).toMatchObject({
      status: "existing",
      localId: wanted,
      documentId: wanted,
    });
    expect(
      await defaultDocumentsPersistence.loadDocument(
        h.database.execSql,
        preferredLocalId,
      ),
    ).toEqual(before);
  } finally {
    h.close();
  }
});

test("a factory preserves the preferred row's bound identity instead of its planned hash", async () => {
  const h = await fixture();
  try {
    const bound = await deriveStableDocumentId("bound-profile");
    await h.seed(preferredLocalId, bound);
    expect(await resolveProfileDocumentIdentity(h.input)).toMatchObject({
      status: "existing",
      localId: preferredLocalId,
      documentId: bound,
    });
  } finally {
    h.close();
  }
});

test.each([null, "current-profile"])(
  "current identity outranks recovery metadata: %s",
  async (current) => {
    const h = await fixture();
    try {
      const recovery = await deriveStableDocumentId("recovery-profile");
      const bound = current ? await deriveStableDocumentId(current) : null;
      await h.seed(preferredLocalId, recovery);
      // Reader coverage for already-admitted reset/rebound metadata, not a new
      // recovery producer. Ordinary saveDocument clears recovery on binding.
      await h.database.execSql(
        "UPDATE documents SET document_id = :current, recovery_document_id = :recovery WHERE local_id = :localId",
        {
          ":current": bound,
          ":recovery": recovery,
          ":localId": preferredLocalId,
        },
      );
      const before = await defaultDocumentsPersistence.loadDocument(
        h.database.execSql,
        preferredLocalId,
      );
      expect(before?.documentId ?? before?.recoveryDocumentId).toBe(
        bound ?? recovery,
      );
      expect(await resolveProfileDocumentIdentity(h.input)).toMatchObject({
        status: "existing",
        localId: preferredLocalId,
        documentId: bound ?? recovery,
      });
      expect(
        await defaultDocumentsPersistence.loadDocument(
          h.database.execSql,
          preferredLocalId,
        ),
      ).toEqual(before);
    } finally {
      h.close();
    }
  },
);

test("recovery-only aliases are found without rewriting their identity", async () => {
  const h = await fixture();
  try {
    const wanted = await deriveStableDocumentId(preferredLocalId);
    await h.seed("reset-profile-alias", wanted);
    await h.database.execSql(
      "UPDATE documents SET document_id = NULL, recovery_document_id = :recovery WHERE local_id = :localId",
      { ":recovery": wanted, ":localId": "reset-profile-alias" },
    );
    const before = await defaultDocumentsPersistence.loadDocument(
      h.database.execSql,
      "reset-profile-alias",
    );
    expect(await resolveProfileDocumentIdentity(h.input)).toMatchObject({
      status: "existing",
      localId: "reset-profile-alias",
      documentId: wanted,
    });
    expect(
      await defaultDocumentsPersistence.loadDocument(
        h.database.execSql,
        "reset-profile-alias",
      ),
    ).toEqual(before);
    expect(
      await defaultDocumentsPersistence.loadDocument(
        h.database.execSql,
        preferredLocalId,
      ),
    ).toBeNull();
  } finally {
    h.close();
  }
});

test("profile recovery lookup does not load unrelated records", async () => {
  const h = await fixture();
  try {
    const wanted = await deriveStableDocumentId(preferredLocalId);
    await h.seed("bounded-recovery-alias", wanted);
    await h.database.execSql(
      "UPDATE documents SET document_id = NULL, recovery_document_id = :recovery WHERE local_id = :localId",
      { ":recovery": wanted, ":localId": "bounded-recovery-alias" },
    );
    for (let index = 0; index < 16; index += 1) {
      const id = `unrelated-profile-${index}`;
      await h.seed(id, await deriveStableDocumentId(id));
    }
    const load = spyOn(defaultDocumentsPersistence, "loadDocument");
    try {
      expect(await resolveProfileDocumentIdentity(h.input)).toMatchObject({
        status: "existing",
        localId: "bounded-recovery-alias",
        documentId: wanted,
      });
      expect(
        load.mock.calls
          .map(([, id]) => id)
          .filter((id) => id.startsWith("unrelated-profile-")),
      ).toEqual([]);
      expect(load.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      load.mockRestore();
    }
  } finally {
    h.close();
  }
});

test("an expired lookup cannot resolve or open a profile after an A-B-A runtime change", async () => {
  const h = await fixture();
  const version = h.sdk.runtime.version;
  const original = defaultDocumentsPersistence.loadDocument;
  const load = spyOn(
    defaultDocumentsPersistence,
    "loadDocument",
  ).mockImplementation(async (...args) => {
    const record = await original(...args);
    h.sdk.database.clear();
    h.sdk.database.configure({
      execSql: h.database.execSql,
      id: "profile-identity-db",
    });
    return record;
  });
  const open = spyOn(h.sdk.documents, "open");
  try {
    expect(
      await resolveProfileDocumentIdentity({
        ...h.input,
        stillCurrent: () => h.sdk.runtime.version === version,
      }),
    ).toEqual({ status: "unavailable" });
    expect(h.sdk.runtime.version).not.toBe(version);
    expect(load).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  } finally {
    load.mockRestore();
    open.mockRestore();
    h.close();
  }
});
