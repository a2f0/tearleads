import { useState } from "react";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";

/**
 * The organization ID search shared by the organization list and the data
 * usage report. Submitting the applied search again refreshes instead.
 */
export function OrganizationSearchForm({
  search,
  loading,
  onSearch,
  onRefresh,
}: {
  search: string;
  loading: boolean;
  onSearch: (search: string) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState(search);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (search === draft.trim()) onRefresh();
        else onSearch(draft.trim());
      }}
    >
      <MiniAppToolbar wrap>
        <MiniAppInput
          aria-label="Search organizations"
          placeholder="Organization ID"
          value={draft}
          maxLength={200}
          onChange={(event) => setDraft(event.target.value)}
          className="root-console-filter"
        />
        <MiniAppButton type="submit" disabled={loading}>
          Search
        </MiniAppButton>
        <MiniAppButton disabled={loading} onClick={onRefresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}
