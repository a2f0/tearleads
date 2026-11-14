import { useCallback } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { PendingBlobDeletionView } from "../../shared/pending-deletion/PendingBlobDeletionView";

export function PendingBlobDeletionReport() {
  const tearleads = useTearleads();
  const request = useCallback(
    (cursor: string | null) =>
      tearleads.root.listPendingBlobDeletions({
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      }),
    [tearleads],
  );
  return <PendingBlobDeletionView request={request} showOrganization />;
}
