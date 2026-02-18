import { vi } from 'vitest';
import { setKeychainDependencies } from '../../lib/keychainDependencies';

export const mockGetInstances = vi.fn();
export const mockGetKeyStatusForInstance = vi.fn();
export const mockDeleteSessionKeysForInstance = vi.fn();

vi.mock('@client/db/instanceRegistry', () => ({
  getInstances: () => mockGetInstances()
}));

vi.mock('@client/db/crypto/keyManager', () => ({
  getKeyStatusForInstance: (id: string) => mockGetKeyStatusForInstance(id),
  deleteSessionKeysForInstance: (id: string) =>
    mockDeleteSessionKeysForInstance(id)
}));

vi.mock('@client/i18n', () => ({
  useTypedTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('../../pages/keychain/InstanceKeyRow', () => ({
  InstanceKeyRow: ({
    info,
    onToggle,
    onDeleteSessionKeys,
    onContextMenu
  }: {
    info: { instance: { id: string; name: string } };
    onToggle: () => void;
    onDeleteSessionKeys: (id: string) => void;
    onContextMenu: (event: React.MouseEvent, info: unknown) => void;
  }) => {
    return (
      <div data-testid={`instance-row-${info.instance.id}`}>
        {info.instance.name}
        <button data-testid="toggle-btn" onClick={onToggle} type="button">
          Toggle
        </button>
        <button
          data-testid="delete-btn"
          onClick={() => onDeleteSessionKeys(info.instance.id)}
          type="button"
        >
          Delete
        </button>
        <button
          data-testid="context-btn"
          onClick={(event) => onContextMenu(event, info)}
          type="button"
        >
          Context
        </button>
      </div>
    );
  }
}));

export let capturedOnDelete: (() => Promise<void>) | undefined;

vi.mock('../../pages/keychain/DeleteSessionKeysDialog', () => ({
  DeleteSessionKeysDialog: ({
    open,
    onOpenChange,
    onDelete
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: () => Promise<void>;
  }) => {
    capturedOnDelete = onDelete;
    return open ? (
      <div data-testid="delete-dialog">
        <button data-testid="confirm-delete" onClick={onDelete} type="button">
          Confirm
        </button>
        <button
          data-testid="cancel-delete"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          Cancel
        </button>
      </div>
    ) : null;
  }
}));

export let capturedMenuOnClose: (() => void) | undefined;

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();
  return {
    ...actual,
    DesktopContextMenu: ({
      children,
      onClose
    }: {
      children: React.ReactNode;
      onClose: () => void;
    }) => {
      capturedMenuOnClose = onClose;
      return <div data-testid="context-menu">{children}</div>;
    },
    DesktopContextMenuItem: ({
      children,
      onClick
    }: {
      children: React.ReactNode;
      onClick: () => void;
    }) => (
      <button data-testid="context-menu-item" onClick={onClick} type="button">
        {children}
      </button>
    )
  };
});

export function resetKeychainWindowContentTestState(): void {
  vi.clearAllMocks();
  setKeychainDependencies({
    getInstances: () => mockGetInstances(),
    getInstance: async (instanceId) => {
      const instances = await mockGetInstances();
      return (
        instances.find(
          (instance: { id: string }) => instance.id === instanceId
        ) ?? null
      );
    },
    deleteInstanceFromRegistry: async () => {},
    getKeyStatusForInstance: (instanceId) =>
      mockGetKeyStatusForInstance(instanceId),
    deleteSessionKeysForInstance: (instanceId) =>
      mockDeleteSessionKeysForInstance(instanceId),
    resetInstanceKeys: async () => {}
  });
}
