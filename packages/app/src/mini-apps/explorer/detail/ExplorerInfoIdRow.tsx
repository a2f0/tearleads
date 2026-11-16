import { MiniAppCopyValue } from "../../../components/mini-app/MiniAppLayout";
import { MiniAppKeyValueRow } from "../../../components/mini-app/MiniAppTable";
import { compactId } from "./compactId";

/**
 * A Get Info row for an id or hash: shortened in place, and tapped or clicked
 * to copy the full value.
 */
export function ExplorerInfoIdRow(params: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <MiniAppKeyValueRow label={params.label}>
      <MiniAppCopyValue
        display={compactId(params.value)}
        label={params.label}
        value={params.value}
      />
    </MiniAppKeyValueRow>
  );
}
