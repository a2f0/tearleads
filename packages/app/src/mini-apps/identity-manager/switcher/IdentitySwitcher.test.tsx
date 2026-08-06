import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { IdentitySwitcher } from "./IdentitySwitcher";
import type { IdentitySwitcherState } from "./useIdentitySwitcher";

afterEach(cleanup);

function createSwitcher(
  overrides: Partial<IdentitySwitcherState> = {},
): IdentitySwitcherState {
  return {
    activeIdentityId: "a".repeat(64),
    available: true,
    busy: false,
    createIdentity: async () => {},
    error: null,
    identities: [
      {
        addedAt: "2026-01-01T00:00:00.000Z",
        signingFingerprint: "a".repeat(64),
      },
      {
        addedAt: "2026-01-02T00:00:00.000Z",
        signingFingerprint: "b".repeat(64),
      },
    ],
    selectIdentity: async () => {},
    ...overrides,
  };
}

test("identity switcher shows the active fingerprint and selects another identity", () => {
  const selected: string[] = [];
  const view = render(
    <IdentitySwitcher
      switcher={createSwitcher({
        selectIdentity: async (signingFingerprint) => {
          selected.push(signingFingerprint);
        },
      })}
    />,
  );

  const trigger = view.getByRole("combobox", { name: "Identities" });
  expect(trigger.textContent).toContain("aaaaaaaaaaaa...aaaaaaaa");
  fireEvent.click(trigger);
  fireEvent.click(
    view.getByRole("option", { name: "bbbbbbbbbbbb...bbbbbbbb" }),
  );

  expect(selected).toEqual(["b".repeat(64)]);
  expect(view.queryByRole("listbox")).toBeNull();
});

test("identity switcher creates another identity from its footer", () => {
  let createCount = 0;
  const view = render(
    <IdentitySwitcher
      switcher={createSwitcher({
        createIdentity: async () => {
          createCount += 1;
        },
      })}
    />,
  );

  fireEvent.click(view.getByRole("combobox", { name: "Identities" }));
  fireEvent.click(view.getByText("New Identity"));

  expect(createCount).toBe(1);
  expect(view.queryByRole("listbox")).toBeNull();
});

test("identity switcher is hidden when local identity persistence is unavailable", () => {
  const view = render(
    <IdentitySwitcher switcher={createSwitcher({ available: false })} />,
  );

  expect(view.queryByRole("combobox", { name: "Identities" })).toBeNull();
});
