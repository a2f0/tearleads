import { expect, test } from "bun:test";
import { createWebDirectCheckout } from "../src/webDirectCheckout";

/**
 * The capability's non-trivial logic: the decline-vs-throw split, the
 * unmount race, and the reset of a failed script load. A fake `loadStripe`
 * stands in for the real SDK so none of this needs a browser.
 */

const ENV_KEY = "BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY";

interface FakeElement {
  mount(host: unknown): void;
  destroy(): void;
}

function fakeStripe(options?: {
  confirmError?: { type?: string; message?: string };
  onConfirm?: () => void;
}) {
  const destroyed: string[] = [];
  const element: FakeElement = {
    mount: () => undefined,
    destroy: () => destroyed.push("payment"),
  };
  const stripe = {
    elements: () => ({
      create: () => element,
      getElement: () => element,
    }),
    confirmPayment: async () => {
      options?.onConfirm?.();
      return { error: options?.confirmError };
    },
  };
  return { stripe, destroyed };
}

const APPEARANCE = {
  colorBackground: "#fff",
  colorText: "#000",
  colorTextSecondary: "#333",
  colorDanger: "#b00020",
  colorPrimary: "#000",
  colorBorder: "#ccc",
  fontFamily: "monospace",
  fontSizeBase: "16px",
  borderRadius: "0",
  inputPaddingBlock: "8px",
};

function withKey<T>(run: () => T): T {
  const previous = process.env[ENV_KEY];
  process.env[ENV_KEY] = "pk_test_fake";
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  }
}

function host(): HTMLElement {
  return { nodeType: 1 } as unknown as HTMLElement;
}

test("no publishable key yields the unavailable stub", () => {
  const previous = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  try {
    expect(createWebDirectCheckout().isAvailable).toBe(false);
  } finally {
    if (previous !== undefined) {
      process.env[ENV_KEY] = previous;
    }
  }
});

test("a card error is a decline the buyer can correct, not a throw", async () => {
  const { stripe } = fakeStripe({
    confirmError: { type: "card_error", message: "Your card was declined." },
  });
  const session = await withKey(() =>
    createWebDirectCheckout((() => Promise.resolve(stripe)) as never).mount({
      host: host(),
      clientSecret: "pi_secret",
      appearance: APPEARANCE,
    }),
  );

  expect(await session.confirm()).toEqual({
    kind: "declined",
    message: "Your card was declined.",
  });
});

test("a non-buyer error throws so the caller surfaces a real failure", async () => {
  const { stripe } = fakeStripe({
    confirmError: { type: "api_error", message: "Provider unavailable." },
  });
  const session = await withKey(() =>
    createWebDirectCheckout((() => Promise.resolve(stripe)) as never).mount({
      host: host(),
      clientSecret: "pi_secret",
      appearance: APPEARANCE,
    }),
  );

  expect(session.confirm()).rejects.toThrow("Provider unavailable.");
});

test("confirming after unmount reports cancelled, never a live success", async () => {
  let confirmed = false;
  const { stripe, destroyed } = fakeStripe({
    onConfirm: () => {
      confirmed = true;
    },
  });
  const session = await withKey(() =>
    createWebDirectCheckout((() => Promise.resolve(stripe)) as never).mount({
      host: host(),
      clientSecret: "pi_secret",
      appearance: APPEARANCE,
    }),
  );

  session.unmount();
  expect(destroyed).toEqual(["payment"]);
  // The element is gone; a confirm now must not be reported as a payment.
  expect(await session.confirm()).toEqual({ kind: "cancelled" });
  expect(confirmed).toBe(false);
});

test("a failed script load throws and does not cache the failure", async () => {
  let loads = 0;
  const loader = (() => {
    loads += 1;
    // First attempt fails to load (blocked script / offline).
    return Promise.resolve(loads === 1 ? null : fakeStripe().stripe);
  }) as never;
  const capability = withKey(() => createWebDirectCheckout(loader));

  expect(
    capability.mount({
      host: host(),
      clientSecret: "pi_secret",
      appearance: APPEARANCE,
    }),
  ).rejects.toThrow("could not be loaded");

  // A retry must load again rather than replay the cached failure.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const session = await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: APPEARANCE,
  });
  expect(session).toBeDefined();
  expect(loads).toBe(2);
});
