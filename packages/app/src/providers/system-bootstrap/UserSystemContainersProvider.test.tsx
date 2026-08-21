import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import * as SystemContainers from "../../stores/systemContainers";
import * as SymCryptProvider from "../sdk/SymCryptProvider";
import {
  UserSystemContainersProvider,
  useUserSystemContainers,
} from "./UserSystemContainersProvider";

afterEach(() => {
  cleanup();
  mock.restore();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("derives user system containers once per identity for every consumer", async () => {
  const firstKey = new Uint8Array([1]);
  const secondKey = new Uint8Array([2]);
  let signingPrivateKey = firstKey;
  const pendingByKey = new Map<
    Uint8Array,
    Deferred<ReadonlyArray<SystemContainers.UserSystemContainer>>
  >();
  const derive = spyOn(
    SystemContainers,
    "deriveUserSystemContainers",
  ).mockImplementation((key) => {
    const pending =
      deferred<ReadonlyArray<SystemContainers.UserSystemContainer>>();
    pendingByKey.set(key, pending);
    return pending.promise;
  });
  spyOn(SymCryptProvider, "useSymCryptRuntime").mockImplementation(
    () =>
      ({
        crypto: { signingKeyPair: { signingPrivateKey } },
      }) as ReturnType<typeof SymCryptProvider.useSymCryptRuntime>,
  );
  spyOn(SymCryptProvider, "useSymCrypt").mockReturnValue({
    logError: () => undefined,
  } as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>);
  const firstConsumerValues: Array<
    ReadonlyArray<SystemContainers.UserSystemContainer>
  > = [];
  const secondConsumerValues: Array<
    ReadonlyArray<SystemContainers.UserSystemContainer>
  > = [];
  const recordFirstConsumerValue = (
    value: ReadonlyArray<SystemContainers.UserSystemContainer>,
  ) => {
    firstConsumerValues.push(value);
  };
  const recordSecondConsumerValue = (
    value: ReadonlyArray<SystemContainers.UserSystemContainer>,
  ) => {
    secondConsumerValues.push(value);
  };

  function Probe({
    onValue,
  }: {
    onValue: (
      value: ReadonlyArray<SystemContainers.UserSystemContainer>,
    ) => void;
  }) {
    const value = useUserSystemContainers();
    useEffect(() => onValue(value), [onValue, value]);
    return null;
  }

  function Harness({ tick }: { tick: number }) {
    return (
      <UserSystemContainersProvider>
        <output>{tick}</output>
        <Probe onValue={recordFirstConsumerValue} />
        <Probe onValue={recordSecondConsumerValue} />
      </UserSystemContainersProvider>
    );
  }

  const view = render(<Harness tick={0} />);
  expect(derive).toHaveBeenCalledTimes(1);
  expect(firstConsumerValues[0]).toBe(secondConsumerValues[0]);

  const firstContainers: ReadonlyArray<SystemContainers.UserSystemContainer> = [
    {
      icon: null,
      kind: "contacts",
      name: "Contacts",
      provisionedAtOrganizationCreation: false,
      systemSlot:
        "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as SystemContainers.UserSystemContainer["systemSlot"],
    },
  ];
  await act(async () => pendingByKey.get(firstKey)?.resolve(firstContainers));
  expect(firstConsumerValues.at(-1)).toBe(firstContainers);
  expect(secondConsumerValues.at(-1)).toBe(firstContainers);

  signingPrivateKey = secondKey;
  view.rerender(<Harness tick={1} />);
  expect(derive).toHaveBeenCalledTimes(2);
  expect(firstConsumerValues.at(-1)).toBe(firstContainers);

  const secondContainers: ReadonlyArray<SystemContainers.UserSystemContainer> =
    [
      {
        icon: null,
        kind: "trash",
        name: "Trash",
        provisionedAtOrganizationCreation: true,
        systemSlot:
          "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as SystemContainers.UserSystemContainer["systemSlot"],
      },
    ];
  await act(async () => pendingByKey.get(secondKey)?.resolve(secondContainers));
  expect(firstConsumerValues.at(-1)).toBe(secondContainers);
  expect(secondConsumerValues.at(-1)).toBe(secondContainers);
});
