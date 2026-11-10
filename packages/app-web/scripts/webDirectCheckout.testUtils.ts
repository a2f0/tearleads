/**
 * Shared fakes for the web direct-checkout capability tests: a fake
 * `loadStripe` result, an app-owned host, and theme tokens, so none of the
 * capability's logic needs a browser.
 */

export const ENV_KEY = "BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY";

type Handler = (event: unknown) => void;

interface FakeElement {
  mount(host: unknown): void;
  destroy(): void;
  on(event: string, handler: Handler): FakeElement;
}

/**
 * A fake Stripe whose Contact Details element reports `email` as soon as the
 * capability subscribes to it (`null` reports an incomplete, empty field).
 * `emit(type, event, payload)` fires any other subscribed element event, such
 * as `ready` or `loaderror`.
 */
export function fakeStripe(options?: {
  confirmError?: { type?: string; message?: string };
  onConfirm?: () => void;
  /** What `elements.submit()` reports: Stripe's form validation. */
  submitError?: { type?: string; message?: string };
  email?: string | null;
  /** Element types whose `create` throws, as a provider failure would. */
  failCreate?: readonly string[];
}) {
  const destroyed: string[] = [];
  /** Every destroy as `<elements group index>:<type>`, in order. */
  const destroyedByGroup: string[] = [];
  const confirmInputs: unknown[] = [];
  const created: { type: string; opts: unknown }[] = [];
  const email =
    options?.email === undefined ? "buyer@example.com" : options.email;
  const handlers: { type: string; event: string; handler: Handler }[] = [];
  const makeElement = (group: number, type: string): FakeElement => {
    const element: FakeElement = {
      mount: () => undefined,
      destroy: () => {
        destroyed.push(type);
        destroyedByGroup.push(`${group}:${type}`);
      },
      on: (event, handler) => {
        if (type === "contactDetails" && event === "change") {
          handler({ complete: email !== null, value: { email: email ?? "" } });
        }
        handlers.push({ type, event, handler });
        return element;
      },
    };
    return element;
  };
  const emit = (type: string, event: string, payload: unknown = {}) => {
    for (const subscription of handlers) {
      if (subscription.type === type && subscription.event === event) {
        subscription.handler(payload);
      }
    }
  };
  const elementsOptions: unknown[] = [];
  const stripe = {
    elements: (opts: unknown) => {
      elementsOptions.push(opts);
      // Each Elements group owns its elements, as in Stripe.js.
      const group = elementsOptions.length - 1;
      const byType = new Map<string, FakeElement>();
      return {
        create: (type: string, opts: unknown) => {
          if (options?.failCreate?.includes(type)) {
            throw new Error(`${type} element failed`);
          }
          created.push({ type, opts });
          const element = makeElement(group, type);
          byType.set(type, element);
          return element;
        },
        getElement: (type: string) => byType.get(type) ?? null,
        submit: async () =>
          options?.submitError ? { error: options.submitError } : {},
      };
    },
    confirmPayment: async (input: unknown) => {
      confirmInputs.push(input);
      options?.onConfirm?.();
      return { error: options?.confirmError };
    },
  };
  return {
    confirmInputs,
    created,
    elementsOptions,
    emit,
    stripe,
    destroyed,
    destroyedByGroup,
  };
}

/** The Price the form shows, as the checkout options report it. */
export const PRICE = { amount: 500, currency: "usd" };

/** The server starting the subscription at Pay. */
export const startPayment = () => Promise.resolve("pi_secret");

export const APPEARANCE = {
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

export function withKey<T>(run: () => T): T {
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

export interface FakeHost {
  children: { tag: string; remove(): void }[];
}

/** An app-owned host whose wrapper nodes can remove themselves. */
export function host(): HTMLElement {
  const fake: FakeHost & Record<string, unknown> = {
    nodeType: 1,
    children: [],
    ownerDocument: {
      createElement: (tag: string) => {
        const node = {
          tag,
          remove: () => {
            fake.children = fake.children.filter((child) => child !== node);
          },
        };
        return node;
      },
    },
    append: (...nodes: FakeHost["children"]) => {
      fake.children.push(...nodes);
    },
  };
  return fake as unknown as HTMLElement;
}
