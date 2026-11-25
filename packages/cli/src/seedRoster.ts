import { hkdfSync } from "node:crypto";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import {
  type ContinuityGroup,
  continuityRosterActions,
  createGroupMembersSeed,
  seedRosterEntry,
} from "app/continuity";
import { registerAccount } from "./registerAccount";
import { type CliSession, withSession } from "./session";

// Roster writes settle as the organization read model catches up with each
// membership change, which takes a few round trips.
const SETTLE_ATTEMPTS = 40;
const SETTLE_DELAY_MS = 250;

// HKDF's own salt keeps member keys apart from the container system slots,
// which the SDK derives (and publishes) as an HMAC keyed directly by the same
// signing key.
const MEMBER_KEY_SALT = "tearleads.continuity/member-recovery-key/v1";

/**
 * A group member's recovery key, derived from the owner's signing key and the
 * member's Continuity ID, so every run reaches the same member accounts and
 * no one else can derive them.
 */
export function memberRecoveryKey(
  ownerSigningPrivateKey: Uint8Array,
  contactId: string,
): string {
  const entropy = hkdfSync(
    "sha256",
    ownerSigningPrivateKey,
    MEMBER_KEY_SALT,
    contactId,
    32,
  );
  return createIdentitySeedPhraseFromEntropy(new Uint8Array(entropy));
}

async function settle(step: () => Promise<boolean>, failure: string) {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    if (await step()) return;
    await Bun.sleep(SETTLE_DELAY_MS);
  }
  throw new Error(failure);
}

/**
 * Creates the member's account unless it exists, then signs in as the member
 * to share the identity link the owner verifies before admitting them, as a
 * person would send theirs.
 */
async function memberIdentityLink(
  session: CliSession,
  apiBaseUrl: string,
  recoveryKey: string,
): Promise<string> {
  const member = { apiBaseUrl, recoveryKey, tracer: session.tracer };
  await registerAccount(member);
  // The link only carries the member's keys; its URL is never opened.
  return withSession(member, ({ sdk }) =>
    sdk.userIdentities.createLink(apiBaseUrl),
  );
}

/**
 * Gives each group member an account, adds them to the signed-in owner's
 * roster with their contact names, and then to the group, creating the group
 * when the organization has none by that name. Idempotent: a rerun finds the
 * same accounts, entries, and groups and writes nothing new.
 */
export async function seedRoster(
  session: CliSession,
  input: {
    readonly apiBaseUrl: string;
    readonly groups: readonly ContinuityGroup[];
    readonly signingPrivateKey: Uint8Array;
  },
): Promise<{ readonly groups: number; readonly members: number }> {
  const { sdk, tracer } = session;
  const actions = await continuityRosterActions(sdk);
  const userIds = new Map<string, string>();
  for (const group of input.groups) {
    const groupUserIds: string[] = [];
    for (const member of group.members) {
      const name = `${member.firstName} ${member.lastName}`;
      let userId = userIds.get(member.contactId);
      if (!userId) {
        const link = await tracer.span(`provision ${member.contactId}`, () =>
          memberIdentityLink(
            session,
            input.apiBaseUrl,
            memberRecoveryKey(input.signingPrivateKey, member.contactId),
          ),
        );
        const verified = await sdk.userIdentities.verifyLink(link);
        const memberUserId = verified.userId;
        await tracer.span(`roster ${member.contactId}`, () =>
          settle(
            () =>
              seedRosterEntry(actions, memberUserId, {
                firstName: member.firstName,
                lastName: member.lastName,
              }),
            `Could not add ${name} to the roster.`,
          ),
        );
        userIds.set(member.contactId, memberUserId);
        userId = memberUserId;
      }
      groupUserIds.push(userId);
    }
    await tracer.span(`group ${group.name}`, () =>
      settle(
        createGroupMembersSeed(actions, group.name, groupUserIds),
        `Could not add the members of ${group.name}.`,
      ),
    );
  }
  // Each settle loop re-read the state it waited for; a failed request or a
  // logged SDK error means one of those reads may have been partial.
  session.assertNoFailures();
  return { groups: input.groups.length, members: userIds.size };
}
