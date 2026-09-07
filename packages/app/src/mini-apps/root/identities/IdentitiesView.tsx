import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { IdentitiesTable } from "./IdentitiesTable";
import { parseFingerprintFilter } from "./rootDisplay";
import { useRootIdentities } from "./useRootIdentities";

export function IdentitiesView({
  onSelectIdentity,
}: {
  onSelectIdentity: (userId: string) => void;
}) {
  const [fingerprintDraft, setFingerprintDraft] = useState("");
  // The applied filter only moves when the draft is empty or a complete
  // fingerprint. Mid-edit drafts keep the last applied listing on screen with
  // a hint instead of refetching everything or firing a rejected request.
  const [appliedFingerprint, setAppliedFingerprint] = useState<string | null>(
    null,
  );
  const draftIsIncomplete =
    parseFingerprintFilter(fingerprintDraft) === undefined;
  const updateFingerprintDraft = useCallback((draft: string) => {
    setFingerprintDraft(draft);
    const parsed = parseFingerprintFilter(draft);
    if (parsed !== undefined) {
      setAppliedFingerprint(parsed);
    }
  }, []);
  const { error, identities, loadMore, loading, nextCursor, refresh } =
    useRootIdentities(appliedFingerprint);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Identities</h2>
      </MiniAppSectionHeading>
      <MiniAppToolbar wrap>
        <MiniAppInput
          aria-label="Filter by signing key fingerprint"
          className="root-console-filter"
          onChange={(event) => updateFingerprintDraft(event.target.value)}
          placeholder="Signing key fingerprint"
          spellCheck={false}
          value={fingerprintDraft}
        />
        <MiniAppButton disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {draftIsIncomplete && (
        <MiniAppStatus>
          Enter the full 64-character hex signing key fingerprint.
        </MiniAppStatus>
      )}
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <IdentitiesTable
        identities={identities}
        loading={loading}
        onSelect={onSelectIdentity}
      />
      {nextCursor !== null && (
        <MiniAppToolbar>
          <MiniAppButton disabled={loading} onClick={loadMore}>
            Load more
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppSection>
  );
}
