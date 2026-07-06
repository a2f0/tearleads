import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { type MouseEvent, useCallback, useRef, useState } from "react";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import type { OrgSwitcherState } from "./hooks/useOrgSwitcher";
import { ORG_MANAGER_LABELS } from "./labels";

function organizationLabel(name: string | null): string {
  return name ?? ORG_MANAGER_LABELS.unnamedOrganization;
}

export function OrgSwitcher({ switcher }: { switcher: OrgSwitcherState }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const activeOrganization = switcher.organizations.find(
    (organization) =>
      organization.organizationId === switcher.activeOrganizationId,
  );

  const closeMenu = useCallback(() => setMenuPosition(null), []);

  const toggleMenu = useCallback(() => {
    setMenuPosition((current) => {
      if (current) {
        return null;
      }

      const rect = triggerRef.current?.getBoundingClientRect();
      return rect ? { x: rect.left, y: rect.bottom } : null;
    });
  }, []);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      switcher.selectOrganization(organizationId);
      closeMenu();
    },
    [closeMenu, switcher.selectOrganization],
  );

  const createOrganization = useCallback(() => {
    switcher.openCreateOrganizationDialog();
    closeMenu();
  }, [closeMenu, switcher.openCreateOrganizationDialog]);

  // Stop the mousedown from reaching the Menu's document-level outside-close
  // listener so clicking the trigger toggles instead of close-then-reopen.
  const keepTriggerClickLocal = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div className="org-manager-switcher">
      <button
        ref={triggerRef}
        aria-expanded={menuPosition !== null}
        aria-haspopup="menu"
        className="org-manager-switcher-trigger"
        onClick={toggleMenu}
        onMouseDown={keepTriggerClickLocal}
        type="button"
      >
        <BuildingsIcon
          aria-hidden="true"
          className="org-manager-switcher-glyph"
          size={16}
          weight="regular"
        />
        <span className="org-manager-switcher-name">
          {activeOrganization
            ? organizationLabel(activeOrganization.name)
            : ORG_MANAGER_LABELS.organizations}
        </span>
        <CaretDownIcon aria-hidden="true" size={12} weight="bold" />
      </button>
      {menuPosition && (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          {switcher.organizations.map((organization) => {
            const isActive =
              organization.organizationId === switcher.activeOrganizationId;
            return (
              <button
                key={organization.organizationId}
                aria-checked={isActive}
                className="org-manager-switcher-option"
                onClick={() => selectOrganization(organization.organizationId)}
                role="menuitemradio"
                type="button"
              >
                <span aria-hidden="true" className="org-manager-switcher-mark">
                  {isActive ? <CheckIcon size={14} weight="bold" /> : null}
                </span>
                <span className="menu-item-label">
                  {organizationLabel(organization.name)}
                </span>
              </button>
            );
          })}
          <hr className="org-manager-switcher-separator" />
          <button
            className="org-manager-switcher-option"
            disabled={switcher.creating}
            onClick={createOrganization}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true" className="org-manager-switcher-mark">
              <PlusIcon size={14} weight="bold" />
            </span>
            <span className="menu-item-label">
              {switcher.creating
                ? ORG_MANAGER_LABELS.creatingOrganization
                : ORG_MANAGER_LABELS.newOrganizationAction}
            </span>
          </button>
        </Menu>
      )}
    </div>
  );
}
