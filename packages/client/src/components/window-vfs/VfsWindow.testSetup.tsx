import type { VfsOpenItem } from '@tearleads/vfs-explorer';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

// Shared mock functions
export const mockOpenWindow = vi.fn();
export const mockRequestWindowOpen = vi.fn();
export const mockResolveFileOpenTarget = vi.fn();
export const mockResolvePlaylistType = vi.fn();
export const mockHandleUpload = vi.fn();
export const mockHandleFileInputChange = vi.fn();
export const mockFileInputRef = { current: null };
export const mockUseDatabaseContext = vi.fn();

// Shared props capture for VfsWindow mock
export let latestProps: {
  onItemOpen?: (item: VfsOpenItem) => void;
  onUpload?: (folderId: string) => void;
} | null = null;

export function resetLatestProps(): void {
  latestProps = null;
}

export function setLatestProps(props: typeof latestProps): void {
  latestProps = props;
}

// Mock component factories
export function createInlineUnlockMock() {
  return ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  );
}

export function createDesktopFloatingWindowMock() {
  return ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
  );
}

export function createClientVfsExplorerProviderMock() {
  return ({ children }: { children: ReactNode }) => <>{children}</>;
}

export function createVfsWindowMock() {
  return (props: {
    onItemOpen?: (item: VfsOpenItem) => void;
    onUpload?: (folderId: string) => void;
  }) => {
    setLatestProps(props);
    return <div data-testid="vfs-window-base" />;
  };
}

// Shared reset function for beforeEach
export function resetAllMocks(): void {
  mockOpenWindow.mockReset();
  mockRequestWindowOpen.mockReset();
  mockResolveFileOpenTarget.mockReset();
  mockResolvePlaylistType.mockReset();
  mockHandleUpload.mockReset();
  mockHandleFileInputChange.mockReset();
  resetLatestProps();

  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });
}
