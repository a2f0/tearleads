import { afterEach, expect, spyOn, test } from "bun:test";
import {
  ELECTROBUN_TELEMETRY_CONSENT_HEADER,
  ELECTROBUN_TELEMETRY_CONSENT_PATH,
} from "../telemetryConsentBridge";
import { shareTelemetryConsentWithMainProcess } from "./mainProcessTelemetryConsent";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => fetchSpy?.mockRestore());

function switchableConsent(initial: boolean) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    enabled: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: boolean) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

test("the main process hears the choice at boot and after each change, in order", async () => {
  const posted: string[] = [];
  const responses: Array<() => void> = [];
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (...[url, init]: Parameters<typeof fetch>) => {
        expect(String(url)).toBe(ELECTROBUN_TELEMETRY_CONSENT_PATH);
        expect(init?.method).toBe("POST");
        posted.push(
          new Headers(init?.headers).get(ELECTROBUN_TELEMETRY_CONSENT_HEADER) ??
            "",
        );
        return new Promise<Response>((resolve) => {
          responses.push(() => resolve(new Response(null, { status: 204 })));
        });
      },
      { preconnect: () => {} },
    ),
  );
  const settle = async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  };
  const consent = switchableConsent(false);
  shareTelemetryConsentWithMainProcess(consent);
  await settle();
  expect(posted).toEqual(["disabled"]);

  // A quick on-then-off while the first post is outstanding waits its turn,
  // and every later post carries the choice as it stands when it leaves.
  consent.set(true);
  consent.set(false);
  await settle();
  expect(posted).toEqual(["disabled"]);
  responses.shift()?.();
  await settle();
  expect(posted).toEqual(["disabled", "disabled"]);
  responses.shift()?.();
  await settle();
  expect(posted).toEqual(["disabled", "disabled", "disabled"]);

  consent.set(true);
  responses.shift()?.();
  await settle();
  expect(posted.at(-1)).toBe("enabled");
});

test("a failed post leaves later ones running", async () => {
  const posted: string[] = [];
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...[, init]: Parameters<typeof fetch>) => {
        posted.push(
          new Headers(init?.headers).get(ELECTROBUN_TELEMETRY_CONSENT_HEADER) ??
            "",
        );
        if (posted.length === 1) throw new TypeError("Load failed");
        return new Response(null, { status: 204 });
      },
      { preconnect: () => {} },
    ),
  );
  const settle = async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  };
  const consent = switchableConsent(false);
  shareTelemetryConsentWithMainProcess(consent);
  await settle();
  consent.set(true);
  await settle();
  expect(posted).toEqual(["disabled", "enabled"]);
});
