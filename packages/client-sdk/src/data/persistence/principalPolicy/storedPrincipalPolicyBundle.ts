export interface StoredPrincipalPolicyBundleJson {
  readonly currentMemberEnvelopesJson: string;
  readonly currentPayloadJson: string;
  readonly currentProjectionJson: string;
  readonly currentGrantsJson: string;
  readonly currentStateJson: string;
  readonly previousStatesJson: string;
}

/**
 * Maps the five stored JSON columns back into the wire bundle shape. Kept as
 * the single column-to-field mapping so a renamed column cannot silently
 * desynchronize one reader from the others; JSON.parse failures propagate for
 * each caller to translate into its own error policy, as does validation.
 */
export function storedPrincipalPolicyBundleFromJson(
  row: StoredPrincipalPolicyBundleJson,
): unknown {
  return {
    currentMemberEnvelopes: JSON.parse(row.currentMemberEnvelopesJson),
    currentPayload: JSON.parse(row.currentPayloadJson),
    currentProjection: JSON.parse(row.currentProjectionJson),
    currentGrants: JSON.parse(row.currentGrantsJson),
    currentState: JSON.parse(row.currentStateJson),
    previousStates: JSON.parse(row.previousStatesJson),
  };
}
