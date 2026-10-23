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

function findIdentity(userId: string) {
  return ROOT_TEST_IDENTITIES.find((candidate) => candidate.userId === userId);
}

function respond(identity: RootIdentitySummaryResponse | undefined) {
  if (!identity) {
    return HttpResponse.json({ error: "User not found" }, { status: 404 });
  }
  return HttpResponse.json<RootIdentitySuspensionResponse>({
    identity: withRootTestSuspension(identity),
  });
}

export const rootSuspensionHandlers = [
  http.put<{ userId: string }>(
    "http://localhost:3001/root/identities/:userId/suspension",
    ({ params }) => {
      const identity = findIdentity(params.userId);
      if (identity?.isRoot) {
        return HttpResponse.json(
          { error: "Root identities cannot be suspended" },
          { status: 409 },
        );
      }
      suspendedUserIds.add(params.userId);
      return respond(identity);
    },
  ),
  http.delete<{ userId: string }>(
    "http://localhost:3001/root/identities/:userId/suspension",
    ({ params }) => {
      suspendedUserIds.delete(params.userId);
      return respond(findIdentity(params.userId));
    },
  ),
];
