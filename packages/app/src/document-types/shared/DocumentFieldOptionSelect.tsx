import { MiniAppSelectMenu } from "../../components/mini-app/controls/MiniAppSelectMenu";
import {
  type DocumentFieldOption,
  getDocumentFieldOptionLabel,
} from "./documentFieldOptions";

/**
 * The picker for a stored option field. Portaled so the open listbox floats
 * over the pane instead of growing the document's scroll region, and so its
 * option buttons never render inside the field's <label>.
 */
export function DocumentFieldOptionSelect(params: {
  ariaLabel: string;
  disabled: boolean;
  id: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<DocumentFieldOption>;
  placeholder: string;
  value: string;
}) {
  const { options } = params;
  // The stored value is compared trimmed everywhere — here, in the label
  // helper, and as the menu's selected id — so a padded value written by
  // another client reads and edits as the same option instead of a duplicate.
  const stored = params.value.trim();
  // A stored value outside this client's option list stays selectable as
  // itself, so opening the editor never silently reverts it to the placeholder.
  const hasUnlistedValue =
    stored.length > 0 && !options.some((option) => option.value === stored);
  const menuOptions = [
    ...(hasUnlistedValue
      ? [{ id: stored, label: getDocumentFieldOptionLabel(options, stored) }]
      : []),
    ...options.map((option) => ({ id: option.value, label: option.label })),
  ];

  return (
    <MiniAppSelectMenu
      ariaLabel={params.ariaLabel}
      disabled={params.disabled}
      id={params.id}
      onChange={params.onChange}
      options={menuOptions}
      placeholder={params.placeholder}
      portaled
      value={stored}
    />
  );
}
