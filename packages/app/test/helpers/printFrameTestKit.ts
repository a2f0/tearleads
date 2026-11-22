interface StubFrame {
  readonly document: Document;
  readonly window: EventTarget & {
    readonly focus: () => void;
    readonly print: () => void;
  };
}

const PROPERTIES = ["contentDocument", "contentWindow"] as const;

/**
 * Sets happy-dom's iframe page loading, returning the previous value. With it
 * off, inserting a frame logs that its about:blank page will not load.
 */
function setIframePageLoading(enabled: boolean): boolean | undefined {
  const settings: unknown = Reflect.get(
    Reflect.get(window, "happyDOM") ?? {},
    "settings",
  );
  if (settings === null || typeof settings !== "object") return undefined;
  const previous: unknown = Reflect.get(settings, "enableIframePageLoading");
  Reflect.set(settings, "enableIframePageLoading", enabled);
  return typeof previous === "boolean" ? previous : undefined;
}

/**
 * Gives every iframe the same-origin about:blank window and document a browser
 * creates on insertion, which happy-dom omits, and records the document of
 * every frame sent to print.
 */
export function installPrintFrameStub({
  frameWindow = true,
}: {
  /** False leaves frames without a window, as a detached frame has. */
  readonly frameWindow?: boolean;
} = {}): {
  readonly printed: Document[];
  readonly restore: () => void;
} {
  const printed: Document[] = [];
  const frames = new WeakMap<HTMLIFrameElement, StubFrame>();
  const frameFor = (frame: HTMLIFrameElement): StubFrame => {
    const existing = frames.get(frame);
    if (existing) return existing;
    const frameDocument = document.implementation.createHTMLDocument("");
    const stub: StubFrame = {
      document: frameDocument,
      window: Object.assign(new EventTarget(), {
        focus: () => undefined,
        print: () => {
          printed.push(frameDocument);
        },
      }),
    };
    frames.set(frame, stub);
    return stub;
  };
  // The stubs below stand in for the page happy-dom would load.
  const iframePageLoading = setIframePageLoading(true);
  const originals = PROPERTIES.map((property) => ({
    descriptor: Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      property,
    ),
    property,
  }));
  Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return frameFor(this).document;
    },
  });
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return frameWindow ? frameFor(this).window : null;
    },
  });

  return {
    printed,
    restore: () => {
      if (iframePageLoading !== undefined) {
        setIframePageLoading(iframePageLoading);
      }
      for (const { descriptor, property } of originals) {
        if (descriptor) {
          Object.defineProperty(
            HTMLIFrameElement.prototype,
            property,
            descriptor,
          );
        } else {
          Reflect.deleteProperty(HTMLIFrameElement.prototype, property);
        }
      }
    },
  };
}
