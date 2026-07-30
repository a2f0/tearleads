import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ROUTED_TABLET_QUERY } from "../../navigation/breakpoints";
import { EnvFileReadTable } from "./EnvFileReadTable";
import type { EnvVariableRow } from "./envFileVariables";

/**
 * A masked .env value ends in the four characters that tell two variables apart,
 * so the fold must give it a line it can actually hold: sharing the primary line
 * with the key leaves it a half-width cell that must also seat two touch-sized
 * controls, and the identifying suffix is the end that gets truncated away.
 */

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.removeAttribute("data-navigation-mode");
  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    return;
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: undefined,
  });
});

const variables: EnvVariableRow[] = [
  {
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    fieldEditors: {},
    id: "v1",
    key: "API_URL",
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    value: "https://api.example.test",
  },
];

function renderFoldedEnvTable() {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query !== ROUTED_TABLET_QUERY,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  return render(
    <EnvFileReadTable
      currentAuthorId="user-alice"
      onEnterEdit={() => undefined}
      variables={variables}
    />,
  );
}

test("phone env table gives the key and the value a line each", () => {
  const view = renderFoldedEnvTable();
  const lines = view.container
    .querySelector(".tracker-read-table-row")
    ?.querySelectorAll(".mini-app-compact-table-line");

  // One field per line, so neither is squeezed into half a phone width.
  expect(
    lines?.[0]?.querySelectorAll(".mini-app-compact-table-field"),
  ).toHaveLength(1);
  expect(
    lines?.[1]?.querySelectorAll(".mini-app-compact-table-field"),
  ).toHaveLength(1);
  expect(lines?.[0]?.textContent).toBe("Key: API_URL");
});

test("phone env table keeps the masked value's identifying suffix and controls", () => {
  const view = renderFoldedEnvTable();

  // The final four characters are the whole point of the mask's suffix.
  expect(view.getByText("********test")).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Show Env variable 1 value" }),
  ).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Copy Env variable 1 value" }),
  ).toBeTruthy();
});
