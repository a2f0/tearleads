/** One action in the Sync Status popover, such as a link into a view. */
export interface SyncStatusPopoverAction {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * The popover body, props-only so its states render and assert without the
 * SDK: the status line, the per-direction detail lines, then its actions
 * (Sync now and links into the views that explain each line).
 */
export function SyncStatusPopover({
  actions,
  details,
  title,
}: {
  actions: ReadonlyArray<SyncStatusPopoverAction>;
  details: ReadonlyArray<string>;
  title: string;
}) {
  return (
    <>
      <p className="sync-status-popover-message">{title}</p>
      {details.length > 0 && (
        <ul className="sync-status-popover-details">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      {actions.map((action) => (
        <button
          className="sync-status-popover-action"
          key={action.id}
          onClick={action.onSelect}
          type="button"
        >
          <span className="menu-item-label">{action.label}</span>
        </button>
      ))}
    </>
  );
}
