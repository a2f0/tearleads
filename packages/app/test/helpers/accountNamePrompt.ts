import { expect } from "bun:test";
import {
  fireEvent,
  type RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  getPaneStatusText,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "./paneTestUtils";

/**
 * Answers the "What should we call you?" prompt that holds an autopilot
 * identity's first registration, once it shows anywhere in `container`.
 */
export async function answerAccountNamePrompt(
  container: HTMLElement,
  name = "Bob",
  timeout = 30_000,
): Promise<void> {
  const [prompt] = await within(container).findAllByRole(
    "textbox",
    { name: "What should we call you?" },
    { timeout },
  );
  invariant(prompt, "Expected the account name prompt");
  fireEvent.change(prompt, { target: { value: name } });
  const form = prompt.closest("form");
  invariant(form, "Expected the account name form");
  fireEvent.submit(form);
}

/** The storage key of the left pane's only identity's sealed naming, if any. */
export function sealedAccountNamingKey(namespace: string): string | null {
  const prefix = `tearleads.account-naming:${namespace}.left:`;
  return (
    Array.from({ length: globalThis.localStorage.length }, (_, i) =>
      globalThis.localStorage.key(i),
    ).find((candidate) => candidate?.startsWith(prefix)) ?? null
  );
}

/** The sealed naming record of the left pane's only identity, if any. */
export function sealedAccountNamingRecord(namespace: string): string | null {
  const key = sealedAccountNamingKey(namespace);
  return key ? globalThis.localStorage.getItem(key) : null;
}

/** Waits until the pane shows an identity's public key. */
export async function waitForPaneKey(view: RenderResult): Promise<void> {
  await waitFor(
    () => {
      expect(getPaneStatusText(view)).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}
