import { useMemo, useState } from "react";
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
  const fingerprintFilter = useMemo(
    () => parseFingerprintFilter(fingerprintDraft),
    [fingerprintDraft],
  );
  // An unparsable draft keeps the last valid listing on screen with a hint,
  // rather than firing a request the server would reject.
  const { error, identities, loadMore, loading, nextCursor, refresh } =
    useRootIdentities(fingerprintFilter ?? null);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Identities</h2>
      </MiniAppSectionHeading>
      <MiniAppToolbar wrap>
        <MiniAppInput
          aria-label="Filter by signing key fingerprint"
          className="root-console-filter"
          onChange={(event) => setFingerprintDraft(event.target.value)}
          placeholder="Signing key fingerprint"
          spellCheck={false}
          value={fingerprintDraft}
        />
        <MiniAppButton disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {fingerprintFilter === undefined && (
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
