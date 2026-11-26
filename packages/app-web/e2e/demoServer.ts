/*
 * The e2e run's demo app server: the `demo` host profile, whose two panes
 * start side by side only once the page agrees to the legal terms. It has no
 * API: a spec that goes past the agreement would have its panes register with
 * the default API URL, so specs here stop at the agreement. Shared by the
 * Playwright config, which starts it, and by the specs that opt into it with
 * `test.use({ baseURL: DEMO_APP_URL })`.
 */
const { APP_WEB_DEMO_PORT = "3112" } = process.env;

export const DEMO_APP_PORT = APP_WEB_DEMO_PORT;
export const DEMO_APP_URL = `http://127.0.0.1:${APP_WEB_DEMO_PORT}`;
