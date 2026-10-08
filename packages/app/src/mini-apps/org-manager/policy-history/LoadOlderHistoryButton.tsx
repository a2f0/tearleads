import { useState } from "react";
import { MiniAppButton } from "../../../components/mini-app/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";

export function LoadOlderHistoryButton({
  load,
}: {
  load: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const loadOlder = async () => {
    setLoading(true);
    try {
      // The scoped refresher reports failures through Org Manager's error state.
      await load();
    } finally {
      setLoading(false);
    }
  };
  return (
    <MiniAppButton disabled={loading} onClick={() => void loadOlder()}>
      {loading
        ? ORG_MANAGER_LABELS.loadingOlderPolicyHistory
        : ORG_MANAGER_LABELS.loadOlderPolicyHistory}
    </MiniAppButton>
  );
}
