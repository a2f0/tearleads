import { installBrowserGlobalsForBun } from '@tearleads/bun-dom-compat';

installBrowserGlobalsForBun();
await import('./setup.js');
