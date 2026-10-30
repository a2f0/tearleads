/**
 * Refuses to admit a user (contact, roster, group member, or share recipient)
 * whose pin was not established by a verified identity link or by this
 * device's own keys. A pin observed on first sight cannot stand in for a link.
 */
export class UnverifiedUserIdentityError extends Error {
  readonly code = "user_identity_unverified";
  readonly userId: string;

  constructor(userId: string) {
    super(
      "Ask this person for their identity link and verify it before adding them.",
    );
    this.name = "UnverifiedUserIdentityError";
    this.userId = userId;
  }
}
