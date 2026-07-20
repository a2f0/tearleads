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
  const confirmInputs: unknown[] = [];
  const element: FakeElement = {
    mount: () => undefined,
    destroy: () => destroyed.push("payment"),
  };
  const elementsOptions: unknown[] = [];
  const stripe = {
    elements: (opts: unknown) => {
      elementsOptions.push(opts);
      return {
        create: () => element,
        getElement: () => element,
      };
    },
    confirmPayment: async (input: unknown) => {
      confirmInputs.push(input);
      options?.onConfirm?.();
      return { error: options?.confirmError };
    },
  };
  return { confirmInputs, elementsOptions, stripe, destroyed };
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

  await expect(session.confirm()).rejects.toThrow("Provider unavailable.");
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

test("a rejected script load surfaces the buyer-facing failure", async () => {
  // The real `loadStripe` REJECTS when the script cannot be fetched (blocked
  // by an extension, offline) — it resolves null only where there is no
  // `window`. Both must reach the buyer as the same message rather than an
  // unhandled rejection. stripe-js memoizes its own script load, so a retry
  // in the same page usually replays the failure; the message promises only
  // that it could not be loaded, not that retrying will help.
  const loader = () => Promise.reject(new Error("blocked by extension"));
  const capability = withKey(() => createWebDirectCheckout(loader));

  await expect(
    capability.mount({
      host: host(),
      clientSecret: "pi_secret",
      appearance: APPEARANCE,
    }),
  ).rejects.toThrow("could not be loaded");
});

test("a null script load surfaces the same buyer-facing failure", async () => {
  // `loadStripe` resolves null where there is no `window` (SSR).
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(null)),
  );

  await expect(
    capability.mount({
      host: host(),
      clientSecret: "pi_secret",
      appearance: APPEARANCE,
    }),
  ).rejects.toThrow("could not be loaded");
});

test("confirm supplies a return url for a redirect-requiring 3-D Secure step", async () => {
  // `redirect: "if_required"` normally keeps the buyer in the panel, but
  // Stripe.js rejects the confirm outright if a redirect DOES become
  // necessary and no return_url was given — which would surface to the buyer
  // as the generic failure label rather than a completed payment.
  const { confirmInputs, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const session = await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: APPEARANCE,
  });

  const previous = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "https://app.example/org/billing" },
  });
  try {
    await session.confirm();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "location");
    } else {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: previous,
      });
    }
  }

  const [input] = confirmInputs as [
    { redirect: string; confirmParams: { return_url: string } },
  ];
  expect(input.redirect).toBe("if_required");
  expect(input.confirmParams.return_url).toBe(
    "https://app.example/org/billing",
  );
});

test("confirm omits the return url where there is no page to return to", async () => {
  // Outside a browser there is no `location`; sending `return_url: undefined`
  // would be an explicit malformed parameter rather than an absent one.
  const { confirmInputs, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const session = await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: APPEARANCE,
  });

  await session.confirm();

  const [input] = confirmInputs as [{ confirmParams?: unknown }];
  expect("confirmParams" in input).toBe(false);
});

test("a charge that lands during an unmount is reported, not swallowed", async () => {
  // Reporting `cancelled` for a payment that actually succeeded would be a
  // lie about money; the caller decides what to do with a late success.
  const { stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const session = await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: APPEARANCE,
  });

  const confirmed = session.confirm();
  session.unmount();

  expect(await confirmed).toEqual({ kind: "succeeded" });
});

test("a dark surface mounts the Payment Element on the night base theme", async () => {
  // The base theme drives the Payment Element's built-in card icon; a light
  // base on a dark surface renders it dark-on-dark.
  const { elementsOptions, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: { ...APPEARANCE, colorBackground: "rgb(17, 17, 17)" },
  });

  const [opts] = elementsOptions as [{ appearance: { theme: string } }];
  expect(opts.appearance.theme).toBe("night");
});

test("a light surface mounts the Payment Element on the stripe base theme", async () => {
  const { elementsOptions, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: { ...APPEARANCE, colorBackground: "rgb(255, 255, 255)" },
  });

  const [opts] = elementsOptions as [{ appearance: { theme: string } }];
  expect(opts.appearance.theme).toBe("stripe");
});

test("an unparseable surface color falls back to the light base theme", async () => {
  // The probe yields computed rgb(), but if that invariant ever changes a
  // non-rgb value must not misclassify as dark — it falls back to light.
  const { elementsOptions, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: { ...APPEARANCE, colorBackground: "not-a-color" },
  });

  const [opts] = elementsOptions as [{ appearance: { theme: string } }];
  expect(opts.appearance.theme).toBe("stripe");
});

test("a transparent surface (unresolved token) uses the light base theme", async () => {
  const { elementsOptions, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: { ...APPEARANCE, colorBackground: "rgba(0, 0, 0, 0)" },
  });

  const [opts] = elementsOptions as [{ appearance: { theme: string } }];
  expect(opts.appearance.theme).toBe("stripe");
});

test("a surface color with too few channels uses the light base theme", async () => {
  const { elementsOptions, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    appearance: { ...APPEARANCE, colorBackground: "rgb(0)" },
  });

  const [opts] = elementsOptions as [{ appearance: { theme: string } }];
  expect(opts.appearance.theme).toBe("stripe");
});
