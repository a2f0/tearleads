/*
 * The e2e run's second app server, which is signed in. The default server
 * (APP_WEB_PORT) has no API, so every other spec runs signed out; this one is
 * built against a real in-memory API, and the default `app` host profile
 * generates and registers an identity on first load. Shared by the Playwright
 * config, which starts both servers, and by the specs that opt into it with
 * `test.use({ baseURL: SIGNED_IN_APP_URL })`.
 */
const { APP_WEB_SIGNED_IN_API_PORT = "3111", APP_WEB_SIGNED_IN_PORT = "3110" } =
  process.env;

export const SIGNED_IN_API_PORT = APP_WEB_SIGNED_IN_API_PORT;
export const SIGNED_IN_APP_PORT = APP_WEB_SIGNED_IN_PORT;
export const SIGNED_IN_API_URL = `http://127.0.0.1:${APP_WEB_SIGNED_IN_API_PORT}`;
export const SIGNED_IN_APP_URL = `http://127.0.0.1:${APP_WEB_SIGNED_IN_PORT}`;
