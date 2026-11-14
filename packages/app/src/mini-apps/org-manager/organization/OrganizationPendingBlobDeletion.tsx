import { useCallback } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { PendingBlobDeletionView } from "../../shared/pending-deletion/PendingBlobDeletionView";

export function OrganizationPendingBlobDeletion({
  organizationId,
}: {
  organizationId: string;
}) {
  const tearleads = useTearleads();
  const request = useCallback(
    (cursor: string | null) =>
      tearleads.organizations.listPendingBlobDeletions(organizationId, {
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      }),
    [organizationId, tearleads],
  );
  return <PendingBlobDeletionView request={request} />;
}
