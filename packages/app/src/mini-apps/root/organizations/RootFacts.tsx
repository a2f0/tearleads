import { MiniAppClipboardButton } from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppKeyValueList,
  MiniAppKeyValueRow,
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
    <MiniAppKeyValueList aria-label={label}>
      {facts.map((fact) => (
        <MiniAppKeyValueRow key={fact.label} label={fact.label}>
          <span className="root-console-fact">
            {fact.value === ""
              ? "Not recorded"
              : (fact.value ?? "Not recorded")}
          </span>
          {fact.copy &&
            typeof fact.value === "string" &&
            fact.value.length > 0 && (
              <MiniAppClipboardButton
                label={`Copy ${fact.label}`}
                value={fact.value}
              />
            )}
        </MiniAppKeyValueRow>
      ))}
    </MiniAppKeyValueList>
  );
}
