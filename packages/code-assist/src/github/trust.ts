/**
 * Trust gate for webhook-triggered actions.
 *
 * The bot sends repository diff and reviewer comments to a third-party LLM and
 * posts replies under its own identity. Neither having an App installation nor
 * being able to comment on a PR implies the actor is trusted: anyone (including
 * an untrusted fork-PR author) can open a PR or reply on a thread. We therefore
 * only act for actors GitHub reports as having a trusted association with the
 * repository, and we never auto-review code coming from a fork.
 */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isTrustedAssociation(
  authorAssociation: string | null | undefined,
): boolean {
  return (
    authorAssociation !== null &&
    authorAssociation !== undefined &&
    TRUSTED_ASSOCIATIONS.has(authorAssociation)
  );
}
