import { MiniAppClipboardButton } from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
} from "../../../components/mini-app/MiniAppTable";

interface RootFact {
  label: string;
  value: string | number | null;
  copy?: boolean;
}
export function RootFacts({
  label,
  facts,
}: {
  label: string;
  facts: ReadonlyArray<RootFact>;
}) {
  return (
    <MiniAppKeyValueTable aria-label={label}>
      <tbody>
        {facts.map((fact) => (
          <MiniAppInfoRow key={fact.label} label={fact.label}>
            <span className="root-console-fact">
              {fact.value ?? "Not recorded"}
            </span>
            {fact.copy && typeof fact.value === "string" && (
              <MiniAppClipboardButton
                label={`Copy ${fact.label}`}
                value={fact.value}
              />
            )}
          </MiniAppInfoRow>
        ))}
      </tbody>
    </MiniAppKeyValueTable>
  );
}
