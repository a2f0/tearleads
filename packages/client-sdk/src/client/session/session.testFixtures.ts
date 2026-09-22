import type { ApiClient } from "@tearleads/api-client";
import { quietLogger } from "../../../test/helpers/clientTestSupport";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import { Database } from "../database";
import { createIdentity, type Identity } from "../identity";
import type { Logger } from "../logger";
import { createSession } from "./index";
import type { SessionDependencies } from "./sessionTypes";

type TestLogger = {
  log: NonNullable<Logger["log"]>;
  logError: NonNullable<Logger["logError"]>;
};

type FakeSessionApi = Pick<
  ApiClient,
  | "authenticate"
  | "authenticateWithChallenge"
  | "clearWriterProjectionCaches"
  | "destroySession"
  | "getAuthToken"
  | "listSessions"
  | "logout"
  | "registerUser"
  | "setAuthToken"
>;

export function createApi(
  overrides: Partial<FakeSessionApi> = {},
): ApiClient & FakeSessionApi {
  let authToken: string | null = null;
  const api: FakeSessionApi = {
    authenticate: async () => null,
    authenticateWithChallenge: async () => null,
    clearWriterProjectionCaches: () => undefined,
    destroySession: async () => null,
    getAuthToken: () => authToken,
    listSessions: async () => null,
    logout: async () => null,
    registerUser: async () => null,
    setAuthToken: (nextAuthToken) => {
      authToken = nextAuthToken;
    },
  };

  return Object.assign(api, overrides) as ApiClient & FakeSessionApi;
}

export function createSessionHarness(
  options: {
    api?: (ApiClient & FakeSessionApi) | undefined;
    database?: Database | undefined;
    identity?: Identity | undefined;
    logger?: TestLogger | undefined;
    boundUserIdForSigningKey?: SessionDependencies["boundUserIdForSigningKey"];
    onUserIdentityAvailable?: SessionDependencies["onUserIdentityAvailable"];
    reportSecurityIncident?: SecurityIncidentReporter | undefined;
  } = {},
) {
  const logger = options.logger ?? quietLogger;
  const api = options.api ?? createApi();
  const database = options.database ?? new Database();
  const identity =
    options.identity ?? createIdentity({}, () => undefined, logger.log);

  return {
    api,
    database,
    identity,
    session: createSession({
      api,
      database,
      identity,
      log: logger.log,
      logError: logger.logError,
      boundUserIdForSigningKey:
        options.boundUserIdForSigningKey ?? (async () => null),
      onUserIdentityAvailable:
        options.onUserIdentityAvailable ?? (async () => undefined),
      reportSecurityIncident: options.reportSecurityIncident,
    }),
  };
}
