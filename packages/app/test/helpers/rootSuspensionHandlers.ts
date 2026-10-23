import type {
  RootIdentitySummaryResponse,
  RootIdentitySuspensionResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { ROOT_TEST_IDENTITIES } from "./rootConsoleFixtures";

const SUSPENDED_AT = "2026-09-07T12:00:00.000Z";
const suspendedUserIds = new Set<string>();

/** The fixture identity with whatever suspension the handlers placed on it. */
export function withRootTestSuspension(
  identity: RootIdentitySummaryResponse,
): RootIdentitySummaryResponse {
  return {
    ...identity,
    suspendedAt: suspendedUserIds.has(identity.userId) ? SUSPENDED_AT : null,
  };
}

function respond(userId: string) {
  const identity = ROOT_TEST_IDENTITIES.find(
    (candidate) => candidate.userId === userId,
  );
  if (!identity) {
    return HttpResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (identity.isRoot) {
    return HttpResponse.json(
      { error: "Root identities cannot be suspended" },
      { status: 409 },
    );
  }
  return HttpResponse.json<RootIdentitySuspensionResponse>({
    identity: withRootTestSuspension(identity),
  });
}

export const rootSuspensionHandlers = [
  http.put<{ userId: string }>(
    "http://localhost:3001/root/identities/:userId/suspension",
    ({ params }) => {
      suspendedUserIds.add(params.userId);
      return respond(params.userId);
    },
  ),
  http.delete<{ userId: string }>(
    "http://localhost:3001/root/identities/:userId/suspension",
    ({ params }) => {
      suspendedUserIds.delete(params.userId);
      return respond(params.userId);
    },
  ),
];
