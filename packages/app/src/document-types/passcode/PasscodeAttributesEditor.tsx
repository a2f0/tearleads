import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId } from "react";
import { MiniAppInfoSection } from "../../components/mini-app/layout/MiniAppSection";
import {
  MiniAppButton,
  MiniAppCheckbox,
} from "../../components/mini-app/MiniAppLayout";
import { PasscodeSecretInput } from "./PasscodeValues";
import {
  newPasscodeAttributeCells,
  type PasscodeAttribute,
} from "./passcodeAttributes";
import {
  PASSCODE_ATTRIBUTE_NAME_FIELD,
  PASSCODE_ATTRIBUTE_PROTECTED,
  PASSCODE_ATTRIBUTE_PROTECTED_FIELD,
  PASSCODE_ATTRIBUTE_VALUE_FIELD,
} from "./passcodeDocumentDefinition";

export interface PasscodeAttributeOperations {
  addRow: (cells: Readonly<Record<string, string>>) => unknown;
  removeRow: (id: string) => void;
  updateRow: (id: string, field: string, value: string) => void;
}

function PasscodeAttributeEditRow(params: {
  attribute: PasscodeAttribute;
  disabled: boolean;
  index: number;
  operations: PasscodeAttributeOperations;
}) {
  const { attribute, disabled, operations } = params;
  const label = `Attribute ${params.index + 1}`;
  const protectedId = useId();
  const update = (field: string, value: string) =>
    operations.updateRow(attribute.id, field, value);

  return (
    <li className="passcode-attribute-edit-row">
      <input
        aria-label={`${label} name`}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) =>
          update(PASSCODE_ATTRIBUTE_NAME_FIELD, event.target.value)
        }
        placeholder="Name"
        spellCheck={false}
        value={attribute.name}
      />
      <div className="passcode-form-control">
        {attribute.isProtected ? (
          <PasscodeSecretInput
            ariaLabel={`${label} value`}
            disabled={disabled}
            onChange={(value) => update(PASSCODE_ATTRIBUTE_VALUE_FIELD, value)}
            placeholder="Value"
            revealLabel={`${label} value`}
            value={attribute.value}
          />
        ) : (
          <input
            aria-label={`${label} value`}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) =>
              update(PASSCODE_ATTRIBUTE_VALUE_FIELD, event.target.value)
            }
            placeholder="Value"
            spellCheck={false}
            value={attribute.value}
          />
        )}
      </div>
      <label className="passcode-attribute-protected" htmlFor={protectedId}>
        <MiniAppCheckbox
          aria-label={`${label} protected`}
          id={protectedId}
          checked={attribute.isProtected}
          disabled={disabled}
          onChange={(event) =>
            update(
              PASSCODE_ATTRIBUTE_PROTECTED_FIELD,
              event.target.checked ? PASSCODE_ATTRIBUTE_PROTECTED : "",
            )
          }
        />
        Protected
      </label>
      <MiniAppButton
        aria-label={`Remove ${label.toLowerCase()}`}
        className="mini-app-icon-button"
        disabled={disabled}
        onClick={() => operations.removeRow(attribute.id)}
        title={`Remove ${label.toLowerCase()}`}
        variant="ghost"
      >
        <TrashIcon aria-hidden size={16} />
      </MiniAppButton>
    </li>
  );
}

/**
 * KeePassX's "Additional attributes" editor: rename, change, protect (mask),
 * or remove each attribute, or add another.
 */
export function PasscodeAttributesEditor(params: {
  attributes: ReadonlyArray<PasscodeAttribute>;
  disabled: boolean;
  operations: PasscodeAttributeOperations;
}) {
  const { attributes, disabled, operations } = params;

  return (
    <MiniAppInfoSection heading="Additional attributes">
      {attributes.length > 0 ? (
        <ul className="passcode-attribute-edit-list">
          {attributes.map((attribute, index) => (
            <PasscodeAttributeEditRow
              key={attribute.id}
              attribute={attribute}
              disabled={disabled}
              index={index}
              operations={operations}
            />
          ))}
        </ul>
      ) : null}
      <div>
        <MiniAppButton
          disabled={disabled}
          onClick={() =>
            void operations.addRow(newPasscodeAttributeCells(attributes.length))
          }
        >
          <PlusIcon aria-hidden size={16} />
          Add Attribute
        </MiniAppButton>
      </div>
    </MiniAppInfoSection>
  );
}
