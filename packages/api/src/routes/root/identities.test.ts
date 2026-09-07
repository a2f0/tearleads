import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const root = createTestUser();
const member = createTestUser();
const MEMBER_IP = "203.0.113.7";
const MISSING_USER_ID = "00000000-0000-4000-8000-000000000000";

interface IdentityBody {
  readonly createdAt: string;
  readonly defaultOrganizationId: string;
  readonly isRoot: boolean;
  readonly lastActiveAt: string | null;
  readonly registrationSourceIpAddress: string | null;
  readonly signingKeyFingerprint: string;
  readonly userId: string;
}

async function fetchAsRoot(
  path: string,
  user: TestUser = root,
): Promise<Response> {
  return routeApp.request(path, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
}

function assertIdentityShape(identity: IdentityBody): void {
  expect(typeof identity.userId).toBe("string");
  expect(typeof identity.signingKeyFingerprint).toBe("string");
  expect(typeof identity.defaultOrganizationId).toBe("string");
  expect(typeof identity.isRoot).toBe("boolean");
  expect(typeof identity.createdAt).toBe("string");
  expect("lastActiveAt" in identity).toBe(true);
  expect("registrationSourceIpAddress" in identity).toBe(true);
}

beforeAll(async () => {
  await registerUser(root);
  await registerUser(member);
  await authenticate(root);
  await authenticate(member);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));

  // A request from a new address advances the member's session activity,
  // which is what persists users.last_active_at.
  const activity = await routeApp.request(
    `/auth/user-identity/${member.userId}`,
    {
      headers: {
        Authorization: `Bearer ${member.token}`,
        "x-forwarded-for": MEMBER_IP,
      },
    },
  );
  expect(activity.status).toBe(200);
});

test("root routes reject unauthenticated requests", async () => {
  const response = await routeApp.request("/root/identities");
  expect(response.status).toBe(401);
});

test("root routes forbid identities that are not root", async () => {
  for (const path of [
    "/root/identities",
    `/root/identities/${root.userId}`,
    `/root/identities/${root.userId}/organizations`,
  ]) {
    const response = await fetchAsRoot(path, member);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  }
});

test("lists platform identities newest first with root flags", async () => {
  const response = await fetchAsRoot("/root/identities");
  expect(response.status).toBe(200);

  const body: { identities: IdentityBody[] } = await response.json();
  expect(Array.isArray(body.identities)).toBe(true);
  for (const identity of body.identities) {
    assertIdentityShape(identity);
  }

  const byId = new Map(
    body.identities.map((identity) => [identity.userId, identity]),
  );
  expect(byId.get(root.userId)?.isRoot).toBe(true);
  expect(byId.get(member.userId)?.isRoot).toBe(false);
  expect(byId.get(member.userId)?.signingKeyFingerprint).toBe(
    member.fingerprint,
  );

  const createdAts = body.identities.map(
    (identity: { createdAt: string }) => identity.createdAt,
  );
  expect(createdAts).toEqual([...createdAts].sort().reverse());
});

test("filters identities by signing key fingerprint", async () => {
  const response = await fetchAsRoot(
    `/root/identities?fingerprint=${member.fingerprint}`,
  );
  expect(response.status).toBe(200);

  const body = await response.json();
  expect(
    body.identities.map((identity: { userId: string }) => identity.userId),
  ).toEqual([member.userId]);
  expect(body.nextCursor).toBeNull();
});

test("pages identities through opaque cursors without gaps or repeats", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 500; page += 1) {
    const query = cursor === null ? "" : `&cursor=${cursor}`;
    const response = await fetchAsRoot(`/root/identities?limit=1${query}`);
    expect(response.status).toBe(200);
    const body: {
      identities: { userId: string }[];
      nextCursor: string | null;
    } = await response.json();
    expect(body.identities.length).toBeLessThanOrEqual(1);
    seen.push(...body.identities.map((identity) => identity.userId));
    cursor = body.nextCursor;
    if (cursor === null) {
      break;
    }
  }

  expect(cursor).toBeNull();
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).toContain(root.userId);
  expect(seen).toContain(member.userId);
});

test("rejects malformed listing queries", async () => {
  // Unknown query keys are tolerated, matching every other registered
  // operation's loose query contract; only declared keys are validated.
  for (const query of [
    "cursor=not-a-cursor",
    "limit=0",
    "limit=201",
    "limit=abc",
    "fingerprint=abc",
  ]) {
    const response = await fetchAsRoot(`/root/identities?${query}`);
    expect(response.status).toBe(400);
  }
});

test("returns an identity with its last activity and live sessions", async () => {
  const response = await fetchAsRoot(`/root/identities/${member.userId}`);
  expect(response.status).toBe(200);

  const body = await response.json();
  assertIdentityShape(body.identity);
  expect(body.identity.userId).toBe(member.userId);
  expect(body.identity.isRoot).toBe(false);
  expect(typeof body.identity.lastActiveAt).toBe("string");

  expect(body.sessions.length).toBeGreaterThanOrEqual(1);
  const session = body.sessions[0];
  expect(session.signingKeyFingerprint).toBe(member.fingerprint);
  expect(session.lastActiveIp).toBe(MEMBER_IP);
  expect(session.ipAddresses).toContain(MEMBER_IP);
  expect(typeof session.createdAt).toBe("string");
  expect(typeof session.lastActiveAt).toBe("string");
  expect("isCurrent" in session).toBe(false);
});

test("returns 404 for an unknown identity and 400 for a malformed id", async () => {
  const missing = await fetchAsRoot(`/root/identities/${MISSING_USER_ID}`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "User not found" });

  const malformed = await fetchAsRoot("/root/identities/not-a-uuid");
  expect(malformed.status).toBe(400);
});

test("lists an identity's organizations with roster and billing standing", async () => {
  const response = await fetchAsRoot(
    `/root/identities/${member.userId}/organizations`,
  );
  expect(response.status).toBe(200);

  const body = await response.json();
  expect(body.organizations.length).toBeGreaterThanOrEqual(1);

  const defaultOrganization = body.organizations.find(
    (organization: { isDefaultOrganization: boolean }) =>
      organization.isDefaultOrganization,
  );
  expect(defaultOrganization).toBeDefined();
  expect(typeof defaultOrganization.organizationId).toBe("string");
  expect(typeof defaultOrganization.name).toBe("string");
  expect(typeof defaultOrganization.createdAt).toBe("string");
  expect(defaultOrganization.roster.status).toBe("active");
  expect(typeof defaultOrganization.roster.joinedAt).toBe("string");
  expect(defaultOrganization.billing).not.toBeNull();
  expect(typeof defaultOrganization.billing.status).toBe("string");
  expect(typeof defaultOrganization.billing.seatCount).toBe("number");

  const missing = await fetchAsRoot(
    `/root/identities/${MISSING_USER_ID}/organizations`,
  );
  expect(missing.status).toBe(404);
});
