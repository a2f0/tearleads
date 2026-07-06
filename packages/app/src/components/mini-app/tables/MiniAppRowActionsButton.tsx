import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsThreeVertical";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppRowActionsButton.css";

/**
 * The overflow ("kebab") action trigger — a `DotsThreeVertical` button that
 * opens a small actions menu. Shared by the Explorer item table and the
 * Identity Manager session table (each in a `.mini-app-row-actions-cell` within
 * a `.mini-app-row-actions-column`), and by the Identity actions toolbar menu
 * (standalone, without the cell/column wrappers).
 *
 * Pass the menu-opening `onClick`, an `aria-label`, and a `title`; all other
 * button attributes (e.g. `aria-expanded` for a toggle, `aria-busy`) pass
 * through.
 */
export const MiniAppRowActionsButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function MiniAppRowActionsButton(
  { className, type = "button", ...props },
  ref,
) {
  return (
    <button
      aria-haspopup="menu"
      {...props}
      className={classNames("mini-app-row-actions-button", className)}
      ref={ref}
      type={type}
    >
      <DotsThreeVerticalIcon aria-hidden="true" size={18} />
    </button>
  );
});
