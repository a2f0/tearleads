import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { Suspense, startTransition } from "react";
import {
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";
import { DocumentContext } from "../../stores/documents/DocumentsProvider";
import { useContactDocumentAddresses } from "./useContactDocumentAddresses";

test("Explorer write identity recovers after an abandoned document render", async () => {
  const fixture = await createAddressRetryHarness("contacts");
  const otherId = await fixture.store.createContact({ firstName: "Grace" });
  const other = otherId ? fixture.documentStores.get(otherId) : undefined;
  if (!other) throw new Error("Missing second document");
  let selected = fixture.document;
  const blocker = Promise.withResolvers<void>();
  let suspendedRenders = 0;
  const hook = renderHook(
    ({ suspend }) => {
      const result = useContactDocumentAddresses();
      if (suspend) {
        suspendedRenders += 1;
        throw blocker.promise;
      }
      return result;
    },
    {
      initialProps: { suspend: false },
      wrapper: ({ children }) => (
        <DocumentContext.Provider value={selected}>
          <Suspense fallback={null}>{children}</Suspense>
        </DocumentContext.Provider>
      ),
    },
  );
  try {
    const initial = hook.result.current;
    await act(async () => {
      startTransition(() => {
        selected = other;
        hook.rerender({ suspend: true });
      });
    });
    expect(suspendedRenders).toBeGreaterThan(0);
    expect(hook.result.current).toBe(initial);
    selected = fixture.document;
    hook.rerender({ suspend: false });
    const id = await hook.result.current.actions.onAddAddress(retryFields, {});
    expect((await fixture.reopen()).rows.map((row) => row.id)).toEqual([id]);
    expect(other.getSnapshot().rows).toHaveLength(0);
  } finally {
    hook.unmount();
    blocker.resolve();
    fixture.close();
  }
});
