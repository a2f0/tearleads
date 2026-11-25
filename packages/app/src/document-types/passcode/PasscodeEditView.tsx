import { useId } from "react";
import {
  type PasscodeAttributeOperations,
  PasscodeAttributesEditor,
} from "./PasscodeAttributesEditor";
import { PasscodeProperties } from "./PasscodeReadView";
import { PasscodeFormRow, PasscodeSecretInput } from "./PasscodeValues";
import type { PasscodeAttribute } from "./passcodeAttributes";
import type { PasscodeDocumentFields } from "./passcodeDocumentDefinition";

type EditableTextField = "tags" | "title" | "url" | "username";

const TEXT_FIELDS: ReadonlyArray<{
  inputMode?: "url";
  key: EditableTextField;
  label: string;
  placeholder?: string;
}> = [
  { key: "title", label: "Title", placeholder: "Bank" },
  { key: "username", label: "Username" },
];

const TRAILING_TEXT_FIELDS: typeof TEXT_FIELDS = [
  { key: "tags", label: "Tags", placeholder: "work, email" },
];

/** KeePassX's entry editor: one labelled control per field, secrets masked. */
export function PasscodeEditView(params: {
  attributes: ReadonlyArray<PasscodeAttribute>;
  attributeOperations: PasscodeAttributeOperations;
  disabled: boolean;
  fields: PasscodeDocumentFields;
  onChange: (patch: Partial<PasscodeDocumentFields>) => void;
  ready: boolean;
}) {
  const { disabled, fields, onChange, ready } = params;
  const id = useId();
  const inputId = (key: string) => `${id}-${key}`;
  const placeholder = (value: string | undefined) =>
    ready ? value : "Loading...";
  const textRow = (field: (typeof TEXT_FIELDS)[number]) => (
    <PasscodeFormRow
      key={field.key}
      inputId={inputId(field.key)}
      label={field.label}
    >
      <input
        autoComplete="off"
        disabled={disabled}
        id={inputId(field.key)}
        inputMode={field.inputMode}
        onChange={(event) => onChange({ [field.key]: event.target.value })}
        placeholder={placeholder(field.placeholder)}
        spellCheck={false}
        value={fields[field.key]}
      />
    </PasscodeFormRow>
  );

  return (
    <>
      <div className="passcode-form">
        {TEXT_FIELDS.map(textRow)}
        <PasscodeFormRow inputId={inputId("password")} label="Password">
          <PasscodeSecretInput
            disabled={disabled}
            id={inputId("password")}
            onChange={(password) => onChange({ password })}
            revealLabel="password"
            value={fields.password}
          />
        </PasscodeFormRow>
        {textRow({
          inputMode: "url",
          key: "url",
          label: "URL",
          placeholder: "https://example.com",
        })}
        <PasscodeFormRow inputId={inputId("otp")} label="TOTP">
          <PasscodeSecretInput
            disabled={disabled}
            id={inputId("otp")}
            onChange={(otp) => onChange({ otp })}
            placeholder={placeholder("otpauth://totp/...")}
            revealLabel="TOTP link"
            value={fields.otp}
          />
        </PasscodeFormRow>
        <PasscodeFormRow inputId={inputId("expirationDate")} label="Expires">
          <input
            disabled={disabled}
            id={inputId("expirationDate")}
            onChange={(event) =>
              onChange({ expirationDate: event.target.value })
            }
            type="date"
            value={fields.expirationDate}
          />
        </PasscodeFormRow>
        {TRAILING_TEXT_FIELDS.map(textRow)}
        <PasscodeFormRow inputId={inputId("notes")} label="Notes">
          <textarea
            disabled={disabled}
            id={inputId("notes")}
            onChange={(event) => onChange({ notes: event.target.value })}
            value={fields.notes}
          />
        </PasscodeFormRow>
      </div>
      <PasscodeAttributesEditor
        attributes={params.attributes}
        disabled={disabled}
        operations={params.attributeOperations}
      />
      <PasscodeProperties fields={fields} />
    </>
  );
}
