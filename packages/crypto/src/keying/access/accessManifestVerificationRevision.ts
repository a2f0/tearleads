/**
 * Revision of the access-manifest verification rules
 * (`verifyContainerAccessManifest`, `verifyDocumentLinkSetManifest` and the
 * checks they call). Bump it in the same change that makes either verifier
 * accept less: servers key their persisted verification markers to it, so a
 * bump makes every stored history re-verify under the tightened rules.
 */
export const ACCESS_MANIFEST_VERIFICATION_REVISION = 1;
