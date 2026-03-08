import { installBrowserGlobalsForBun } from './bunDomCompat.js';

installBrowserGlobalsForBun();
await import('./setup.js');
