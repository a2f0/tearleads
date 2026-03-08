import { JSDOM } from 'jsdom';

let installedDom = false;

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
}

function defineGlobalIfMissing(name: string, value: unknown): void {
  if (typeof Reflect.get(globalThis, name) !== 'undefined') {
    return;
  }
  defineGlobal(name, value);
}

function definePropertyIfMissing(
  target: object,
  property: string,
  value: unknown
): void {
  if (typeof Reflect.get(target, property) !== 'undefined') {
    return;
  }
  Object.defineProperty(target, property, {
    configurable: true,
    writable: true,
    value
  });
}

export function installBrowserGlobalsForBun(): void {
  if (
    installedDom ||
    (typeof globalThis.document !== 'undefined' &&
      typeof globalThis.localStorage !== 'undefined')
  ) {
    return;
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/'
  });

  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  defineGlobal('navigator', dom.window.navigator);
  defineGlobal('HTMLElement', dom.window.HTMLElement);
  defineGlobal('Node', dom.window.Node);
  defineGlobal(
    'getComputedStyle',
    dom.window.getComputedStyle.bind(dom.window)
  );
  defineGlobal('localStorage', dom.window.localStorage);
  defineGlobal('sessionStorage', dom.window.sessionStorage);
  defineGlobalIfMissing('atob', dom.window.atob.bind(dom.window));
  defineGlobalIfMissing('btoa', dom.window.btoa.bind(dom.window));
  const requestAnimationFrameImpl =
    dom.window.requestAnimationFrame?.bind(dom.window) ??
    ((callback: FrameRequestCallback): number =>
      setTimeout(() => {
        callback(Date.now());
      }, 16));
  const cancelAnimationFrameImpl =
    dom.window.cancelAnimationFrame?.bind(dom.window) ??
    ((handle: number): void => {
      clearTimeout(handle);
    });
  defineGlobalIfMissing('requestAnimationFrame', requestAnimationFrameImpl);
  defineGlobalIfMissing('cancelAnimationFrame', cancelAnimationFrameImpl);
  definePropertyIfMissing(
    dom.window,
    'requestAnimationFrame',
    requestAnimationFrameImpl
  );
  definePropertyIfMissing(
    dom.window,
    'cancelAnimationFrame',
    cancelAnimationFrameImpl
  );
  definePropertyIfMissing(
    dom.window.HTMLElement.prototype,
    'attachEvent',
    () => {
      // React's input polyfill path still checks these legacy hooks.
    }
  );
  definePropertyIfMissing(
    dom.window.HTMLElement.prototype,
    'detachEvent',
    () => {
      // No-op keeps jsdom compatible with that branch.
    }
  );

  installedDom = true;
}
