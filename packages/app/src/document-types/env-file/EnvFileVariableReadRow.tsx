import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { TrackerReadCard } from "../shared/TrackerReadCard";
import { EnvFileVariableReadValue } from "./EnvFileVariableReadValue";
import {
  type EnvVariableRow,
  getEnvFileReadValue,
  toEnvVariableDetailFields,
} from "./envFileVariables";

export function EnvFileVariableReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  variable: EnvVariableRow;
}) {
  const { currentAuthorId, index, onEnterEdit, resolveRowWriter, variable } =
    params;
  const keyTitle = variable.key.trim();

  return (
    <TrackerReadCard
      actionsAriaLabel={`Env variable ${index + 1} actions`}
      cells={[
        {
          label: "Key",
          text: getEnvFileReadValue(variable.key),
          title: keyTitle.length > 0 ? keyTitle : undefined,
        },
        {
          content: (
            <EnvFileVariableReadValue index={index} variable={variable} />
          ),
          label: "Value",
        },
      ]}
      className="env-file-variable-read-row tracker-read-row--two-cells"
      currentAuthorId={currentAuthorId}
      detailFields={toEnvVariableDetailFields(variable, resolveRowWriter)}
      detailLabel="Details"
      detailTitle={keyTitle.length > 0 ? keyTitle : `Variable ${index + 1}`}
      directAriaLabel={`Env variable ${index + 1} details`}
      index={index}
      onEnterEdit={onEnterEdit}
      resolveRowWriter={resolveRowWriter}
      row={variable}
    />
  );
}
