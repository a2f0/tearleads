/**
 * Shared fakes for the web direct-checkout capability tests: a fake
 * `loadStripe` result, an app-owned host, and theme tokens, so none of the
 * capability's logic needs a browser.
 */

export const ENV_KEY = "BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY";

interface FakeElement {
  mount(host: unknown): void;
  destroy(): void;
  on(event: string, handler: (event: unknown) => void): FakeElement;
}

/**
 * A fake Stripe whose Contact Details element reports `email` as soon as the
 * capability subscribes to it (`null` reports an incomplete, empty field).
 */
export function fakeStripe(options?: {
  confirmError?: { type?: string; message?: string };
  onConfirm?: () => void;
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
        return element;
      },
    };
    return element;
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
    stripe,
    destroyed,
    destroyedByGroup,
  };
}

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
