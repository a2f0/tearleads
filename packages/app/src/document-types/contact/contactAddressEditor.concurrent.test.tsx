import { expect, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Suspense, startTransition, useSyncExternalStore } from "react";
import {
  addressSurfaces,
  createAddressRetryHarness,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";
import { ContactAddresses } from "./ContactAddresses";

for (const surface of addressSurfaces) {
  for (const change of ["disabled", "editing", "unloaded"] as const) {
    for (const phase of ["suspended", "committed"] as const) {
      test(`${surface}: ${phase} ${change} input uses committed save authority`, async () => {
        const f = await createAddressRetryHarness(surface);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const blocker = Promise.withResolvers<void>();
        let completion: Promise<unknown> = Promise.resolve(null);
        let suspendedRenders = 0;
        const actions = {
          ...f.actions,
          onAddAddress: (
            ...args: Parameters<typeof f.actions.onAddAddress>
          ) => {
            const work = (async () => {
              entered.resolve();
              await release.promise;
              return f.actions.onAddAddress(...args);
            })();
            completion = work.catch((error: unknown) => error);
            return work;
          },
        };
        function Suspend({ suspend }: { suspend: boolean }) {
          if (suspend) {
            suspendedRenders += 1;
            throw blocker.promise;
          }
          return null;
        }
        function Subject({
          changed,
          suspend,
        }: {
          changed: boolean;
          suspend: boolean;
        }) {
          const snapshot = useSyncExternalStore(
            f.document.subscribe,
            f.document.getSnapshot,
          );
          return (
            <Suspense fallback={<p>Preparing another view</p>}>
              <ContactAddresses
                {...actions}
                rows={
                  changed && change === "unloaded" ? undefined : snapshot.rows
                }
                disabled={changed && change === "disabled"}
                isEditing={!(changed && change === "editing")}
                currentAuthorId={null}
              />
              <Suspend suspend={suspend} />
            </Suspense>
          );
        }
        const view = render(<Subject changed={false} suspend={false} />);
        try {
          fireEvent.click(view.getByRole("button", { name: "Add address" }));
          fireEvent.change(view.getByLabelText("Street address"), {
            target: { value: "Visible contact draft" },
          });
          fireEvent.click(view.getByRole("button", { name: "Save address" }));
          await act(async () => {
            await entered.promise;
          });
          if (phase === "suspended") {
            await act(async () => {
              startTransition(() => view.rerender(<Subject changed suspend />));
            });
            expect(suspendedRenders).toBeGreaterThan(0);
            expect(view.getByRole("form")).toBeTruthy();
            expect(view.queryByText("Preparing another view") === null).toBe(
              true,
            );
          } else {
            view.rerender(<Subject changed suspend={false} />);
          }
          let outcome: unknown;
          await act(async () => {
            release.resolve();
            outcome = await completion;
          });
          const durable = await f.reopen();
          if (phase === "suspended") {
            expect(typeof outcome).toBe("string");
            expect(durable.rows).toHaveLength(1);
            expect(outcome).toBe(durable.rows[0]?.id);
            expect(durable.rows[0]?.fields).toMatchObject({
              street: "Visible contact draft",
            });
            await waitFor(() =>
              expect(view.queryByRole("form") === null).toBe(true),
            );
            expect(view.queryByRole("alert") === null).toBe(true);
          } else {
            expect(outcome).toBeInstanceOf(Error);
            expect(durable.rows).toHaveLength(0);
          }
        } finally {
          await act(async () => {
            release.resolve();
            await completion;
          });
          await act(async () => {
            view.unmount();
            blocker.resolve();
          });
          f.close();
        }
      });
    }
  }
}
