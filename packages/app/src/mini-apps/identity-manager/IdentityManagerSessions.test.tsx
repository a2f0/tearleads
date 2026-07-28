import { afterEach, expect, test } from "bun:test";
import type { UserSession } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import { SessionsSection } from "./IdentityManagerSessions";

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);
const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

const SESSION: UserSession = {
  createdAt: "2026-05-28T14:00:00.000Z",
  id: "a".repeat(64),
  ipAddresses: ["198.51.100.10", "203.0.113.9"],
  isCurrent: true,
  lastActiveAt: "2026-05-28T14:05:00.000Z",
  lastActiveIp: "203.0.113.9",
  signingKeyFingerprint: "b".repeat(64),
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
  globalThis.localStorage.clear();

  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidthDescriptor,
    );
  }
  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

function mockLayout(mode: "routed" | "windowed", width: number) {
  document.documentElement.setAttribute("data-navigation-mode", mode);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

function renderSessions(sessions: ReadonlyArray<UserSession> = [SESSION]) {
  return render(
    <SessionsSection
      handleEndSession={async () => undefined}
      loadingSessions={false}
      mutatingSessionId={null}
      onOpenSessionDetail={() => undefined}
      sessionError={null}
      sessions={sessions}
    />,
  );
}

test("active sessions rely on the window toolbar for refresh", () => {
  mockLayout("windowed", 640);
  const view = renderSessions();

  expect(view.queryByRole("button", { name: "Refresh" })).toBeNull();
});

test("active sessions render two-line summaries on narrow mobile layouts", () => {
  mockLayout("routed", 390);
  const view = renderSessions();
  const table = view.getByRole("table");
  const headerLines = Array.from(
    table.querySelectorAll("thead .mini-app-compact-table-line"),
  );
  const bodyLines = Array.from(
    table.querySelectorAll("tbody .mini-app-compact-table-line"),
  );

  expect(headerLines.map((line) => line.textContent)).toEqual([
    "StatusLast Active",
    "Last IP",
  ]);
  expect(bodyLines.map((line) => line.textContent)).toEqual([
    `Status: CurrentLast Active: ${formatMiniAppDateTime(SESSION.lastActiveAt)}`,
    `Last IP: ${SESSION.lastActiveIp}`,
  ]);
  expect(
    table.parentElement?.classList.contains("mini-app-table-frame--two-line"),
  ).toBe(true);
  expect(
    table.parentElement?.style.getPropertyValue(
      "--mini-app-virtual-row-height",
    ),
  ).toBe("56px");
});

test("active sessions stay single-line on wide layouts", () => {
  mockLayout("windowed", 640);
  const view = renderSessions();
  const table = view.getByRole("table");

  expect(table.querySelector(".mini-app-compact-table-lines")).toBeNull();
  expect(table.querySelectorAll("thead th")).toHaveLength(4);
  expect(table.querySelectorAll("tbody tr td")).toHaveLength(4);
  expect(
    table.parentElement?.classList.contains("mini-app-table-frame--two-line"),
  ).toBe(false);
});

test("active sessions render every row without a virtual scroll frame", () => {
  mockLayout("windowed", 640);
  const sessions = Array.from({ length: 30 }, (_, index) => ({
    ...SESSION,
    id: index.toString().padStart(64, "0"),
  }));
  const view = renderSessions(sessions);
  const table = view.getByRole("table");

  expect(table.querySelectorAll("tbody tr")).toHaveLength(sessions.length);
  expect(
    table.parentElement?.classList.contains("mini-app-table-frame--virtual"),
  ).toBe(false);
});
