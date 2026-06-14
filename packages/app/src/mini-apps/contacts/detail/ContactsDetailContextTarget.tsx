import type { MouseEvent, PropsWithChildren } from "react";

const CONTACTS_DETAIL_AREA_IGNORE_SELECTOR =
  "button, a, input, label, select, textarea, .mini-app-field, .mini-app-row";

export type ContactsAreaContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
) => void;

export function ContactsDetailContextTarget({
  children,
  onAreaContextMenu,
}: PropsWithChildren<{
  onAreaContextMenu: ContactsAreaContextMenuHandler;
}>) {
  return (
    <section
      aria-label="Contacts detail"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          (event.target instanceof Element &&
            event.target.closest(CONTACTS_DETAIL_AREA_IGNORE_SELECTOR))
        ) {
          return;
        }

        onAreaContextMenu(event);
      }}
    >
      {children}
    </section>
  );
}
