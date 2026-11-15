import { expect, test } from "bun:test";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";

for (const surface of addressSurfaces) {
  for (const change of [
    "permission",
    "author",
    "scope",
    "key",
    "trash",
  ] as const) {
    if (surface === "contacts" && change === "trash") continue;
    test(`${surface}: ${change} change during recovery prevents the edited follow-up write`, async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let held = false;
      let canWrite = true;
      let author: string | null = null;
      let updates = 0;
      const f = await createAddressRetryHarness(surface, (store) => ({
        ...store,
        getSnapshot: () => ({
          ...store.getSnapshot(),
          canWrite,
          currentAuthorId: author,
        }),
        setStructuredFields: async (...args) => {
          await store.setStructuredFields(...args);
          if (held) {
            entered.resolve();
            await release.promise;
          }
        },
        updateRowFields: async (...args) => {
          updates += 1;
          await store.updateRowFields(...args);
        },
      }));
      try {
        const intent = {};
        f.fail();
        await expect(
          f.actions.onAddAddress(retryFields, intent),
        ).rejects.toThrow();
        held = true;
        const outcome = f.actions
          .onAddAddress(
            { ...retryFields, street: "Must not be written" },
            intent,
          )
          .then(
            () => null,
            (error: unknown) => error,
          );
        await entered.promise;
        if (change === "permission") canWrite = false;
        if (change === "author") author = "different-user";
        if (change === "key" || change === "trash") {
          if (surface === "explorer") {
            if (change === "key") f.changeWriteScope();
            else f.makeReadOnly();
          } else {
            f.store.updateRuntime({
              ...f.runtime,
              documents: {
                ...f.runtime.documents,
                crypto: {
                  ...f.runtime.documents.crypto,
                  signingFingerprint: "changed",
                },
              },
            });
          }
        }
        if (change === "scope") {
          if (surface === "explorer") f.hook?.unmount();
          else
            f.store.updateRuntime({
              ...f.runtime,
              documents: {
                ...f.runtime.documents,
                auth: { ...f.runtime.documents.auth, userId: "different-user" },
              },
            });
        }
        release.resolve();
        expect(await outcome).toBeInstanceOf(Error);
        expect(updates).toBe(0);
        expect((await f.reopen()).rows[0]?.fields).toMatchObject({
          street: retryFields.street,
        });
      } finally {
        release.resolve();
        f.close();
      }
    });
  }
}
