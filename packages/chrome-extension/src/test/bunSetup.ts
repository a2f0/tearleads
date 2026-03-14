import {
  installBrowserGlobalsForBun,
  installVitestPolyfills
} from '@tearleads/bun-dom-compat';
import { vi } from 'vitest';

installBrowserGlobalsForBun();
installVitestPolyfills(vi);
await import('./setup');
