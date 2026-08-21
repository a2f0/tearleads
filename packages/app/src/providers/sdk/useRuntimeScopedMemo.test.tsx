import { afterEach, expect, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { SymCryptProvider, useSymCrypt } from "./SymCryptProvider";
import { useRuntimeScopedMemo } from "./useRuntimeScopedMemo";

afterEach(cleanup);

const HOST_CONFIG = createAppHostConfig({
  apiBaseUrl: "http://api.example.test",
  wsUrl: "ws://events.example.test/runtime-scoped-memo",
});

function RuntimeScopedMemoProbe(props: {
  create: (dependency: string) => object;
  dependency: string;
  onRender: (symcrypt: SymCrypt, value: object) => void;
}) {
  const symcrypt = useSymCrypt();
  const value = useRuntimeScopedMemo(
    () => props.create(props.dependency),
    [props.create, props.dependency],
  );
  props.onRender(symcrypt, value);
  return null;
}

function Harness(props: {
  create: (dependency: string) => object;
  dependency: string;
  onRender: (symcrypt: SymCrypt, value: object) => void;
}) {
  return (
    <AppHostConfigProvider value={HOST_CONFIG}>
      <LocalKeyringLockProvider>
        <LogProvider>
          <SyncModeProvider>
            <SymCryptProvider>
              <RuntimeScopedMemoProbe {...props} />
            </SymCryptProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}

test("reuses values until an explicit dependency or runtime version changes", () => {
  let createCount = 0;
  const create = (dependency: string) => ({
    dependency,
    generation: ++createCount,
  });
  const rendered: Array<{ symcrypt: SymCrypt; value: object }> = [];
  const onRender = (symcrypt: SymCrypt, value: object) => {
    rendered.push({ symcrypt, value });
  };
  const view = render(
    <Harness create={create} dependency="first" onRender={onRender} />,
  );
  const initial = rendered.at(-1);
  if (!initial) {
    throw new Error("Expected the runtime-scoped value to render.");
  }

  expect(createCount).toBe(1);
  view.rerender(
    <Harness create={create} dependency="first" onRender={onRender} />,
  );
  expect(createCount).toBe(1);
  expect(rendered.at(-1)?.value).toBe(initial.value);

  act(() => {
    initial.symcrypt.syncBillingGate.notifyPaymentRequired(
      "runtime-scoped-memo-org",
    );
  });
  const billingScoped = rendered.at(-1)?.value;
  expect(createCount).toBe(2);
  expect(billingScoped).not.toBe(initial.value);

  act(() => {
    initial.symcrypt.events.push({ type: "runtime-scoped-memo" });
  });
  const runtimeScoped = rendered.at(-1)?.value;
  expect(createCount).toBe(3);
  expect(runtimeScoped).not.toBe(billingScoped);

  view.rerender(
    <Harness create={create} dependency="second" onRender={onRender} />,
  );
  expect(createCount).toBe(4);
  expect(rendered.at(-1)?.value).not.toBe(runtimeScoped);
});
