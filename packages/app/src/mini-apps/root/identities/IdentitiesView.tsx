import { MIN_ROOT_FINGERPRINT_PREFIX_LENGTH } from "@tearleads/validators/operation";
import { useId, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppCheckbox,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { IdentitiesTable } from "./IdentitiesTable";
import {
  normalizeIdentityFilterDraft,
  parseIdentityFilter,
} from "./rootDisplay";
import { useRootIdentities } from "./useRootIdentities";

export function IdentitiesView({
  onSelectIdentity,
}: {
  onSelectIdentity: (userId: string) => void;
}) {
  const rootOnlyId = useId();
  const [draft, setDraft] = useState("");
  // The applied filter only moves on a search with an empty draft, a user ID,
  // or a long enough fingerprint prefix. A rejected search keeps the last
  // applied listing on screen with a hint instead of firing a doomed request.
  const [appliedDraft, setAppliedDraft] = useState("");
  const [draftRejected, setDraftRejected] = useState(false);
  const [rootOnly, setRootOnly] = useState(false);
  const filter = useMemo(
    () => parseIdentityFilter(appliedDraft) ?? null,
    [appliedDraft],
  );
  const { error, identities, loadMore, loading, nextCursor, refresh } =
    useRootIdentities(filter, rootOnly);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Identities</h2>
      </MiniAppSectionHeading>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (parseIdentityFilter(draft) === undefined) {
            setDraftRejected(true);
            return;
          }
          setDraftRejected(false);
          const normalized = normalizeIdentityFilterDraft(draft);
          if (normalized === appliedDraft) refresh();
          else setAppliedDraft(normalized);
        }}
      >
        <MiniAppToolbar wrap>
          <MiniAppInput
            aria-label="Search identities"
            className="root-console-filter"
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftRejected(false);
            }}
            placeholder="Signing key fingerprint or user ID"
            spellCheck={false}
            value={draft}
          />
          <MiniAppButton type="submit" disabled={loading}>
            Search
          </MiniAppButton>
          <MiniAppButton disabled={loading} onClick={refresh}>
            {loading ? "Loading..." : "Refresh"}
          </MiniAppButton>
          <label className="root-console-toggle" htmlFor={rootOnlyId}>
            <MiniAppCheckbox
              checked={rootOnly}
              id={rootOnlyId}
              onChange={(event) => setRootOnly(event.target.checked)}
            />
            Root only
          </label>
        </MiniAppToolbar>
      </form>
      {draftRejected && (
        <MiniAppStatus>
          Enter a full user ID, or at least {MIN_ROOT_FINGERPRINT_PREFIX_LENGTH}{" "}
          hex characters of a signing key fingerprint.
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
