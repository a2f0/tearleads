import { MiniAppInfoSection } from "../../components/mini-app/layout/MiniAppSection";
import { MiniAppKeyValueList } from "../../components/mini-app/tables/MiniAppKeyValueList";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import { currentDateOnly } from "../shared/rowLogModel";
import { PasscodeReadRow, PasscodeSecretReadRow } from "./PasscodeValues";
import {
  formatPasscodeExpiry,
  type PasscodeAttribute,
  passcodeAttributeLabel,
} from "./passcodeAttributes";
import type { PasscodeDocumentFields } from "./passcodeDocumentDefinition";

/**
 * Where an imported passcode came from (KeePassX's Properties tab). Shown only
 * when the import recorded it; the fields are not editable.
 */
export function PasscodeProperties(params: { fields: PasscodeDocumentFields }) {
  const { sourceCreatedAt, sourceId, sourceModifiedAt } = params.fields;
  if (!(sourceCreatedAt || sourceId || sourceModifiedAt)) {
    return null;
  }
  const formatTime = (value: string) =>
    formatMiniAppDateTime(value, { emptyFallback: "" });

  return (
    <MiniAppInfoSection heading="Properties">
      <MiniAppKeyValueList
        aria-label="Passcode properties"
        className="passcode-key-values"
      >
        <PasscodeReadRow label="Created" value={formatTime(sourceCreatedAt)} />
        <PasscodeReadRow
          label="Modified"
          value={formatTime(sourceModifiedAt)}
        />
        <PasscodeReadRow label="Source ID" value={sourceId} />
      </MiniAppKeyValueList>
    </MiniAppInfoSection>
  );
}

function PasscodeAttributesRead(params: {
  attributes: ReadonlyArray<PasscodeAttribute>;
}) {
  if (params.attributes.length === 0) {
    return null;
  }

  return (
    <MiniAppInfoSection heading="Additional attributes">
      <MiniAppKeyValueList
        aria-label="Additional attributes"
        className="passcode-key-values"
      >
        {params.attributes.map((attribute, index) => {
          const label = passcodeAttributeLabel(attribute, index);
          return attribute.isProtected ? (
            <PasscodeSecretReadRow
              key={attribute.id}
              label={label}
              revealLabel={`${label} value`}
              value={attribute.value}
            />
          ) : (
            <PasscodeReadRow
              key={attribute.id}
              label={label}
              value={attribute.value}
            />
          );
        })}
      </MiniAppKeyValueList>
    </MiniAppInfoSection>
  );
}

/** The entry as KeePassX shows it: labels beside values, secrets masked. */
export function PasscodeReadView(params: {
  attributes: ReadonlyArray<PasscodeAttribute>;
  fields: PasscodeDocumentFields;
}) {
  const { fields } = params;

  return (
    <>
      <MiniAppKeyValueList aria-label="Entry" className="passcode-key-values">
        <PasscodeReadRow label="Title" value={fields.title} />
        <PasscodeReadRow label="Username" value={fields.username} />
        <PasscodeSecretReadRow
          label="Password"
          revealLabel="password"
          value={fields.password}
        />
        <PasscodeReadRow label="URL" value={fields.url} />
        {fields.otp.length > 0 ? (
          <PasscodeSecretReadRow
            label="TOTP"
            revealLabel="TOTP link"
            value={fields.otp}
          />
        ) : null}
        <PasscodeReadRow
          label="Expires"
          value={formatPasscodeExpiry(fields.expirationDate, currentDateOnly())}
        />
        {fields.tags.trim().length > 0 ? (
          <PasscodeReadRow label="Tags" value={fields.tags} />
        ) : null}
        <PasscodeReadRow label="Notes" multiline value={fields.notes} />
      </MiniAppKeyValueList>
      <PasscodeAttributesRead attributes={params.attributes} />
      <PasscodeProperties fields={fields} />
    </>
  );
}
