import { installBrowserGlobalsForBun } from './bunDomCompat';

installBrowserGlobalsForBun();
await import('./setup');
