import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createClientVfsExplorerProviderMock,
  createDesktopFloatingWindowMock,
  createInlineUnlockMock,
  createVfsWindowMock,
  latestProps,
  mockFileInputRef,
  mockHandleFileInputChange,
  mockHandleUpload,
  mockOpenWindow,
  mockRequestWindowOpen,
  mockResolveFileOpenTarget,
  mockResolvePlaylistType,
  mockUseDatabaseContext,
  resetAllMocks,
  resetLatestProps,
  setLatestProps
} from './VfsWindow.testSetup';

describe('VfsWindow.testSetup helpers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('sets and resets latest props', () => {
    setLatestProps({ onUpload: () => undefined });
    expect(latestProps).not.toBeNull();

    resetLatestProps();
    expect(latestProps).toBeNull();
  });

  it('renders helper mock components', () => {
    const InlineUnlock = createInlineUnlockMock();
    const FloatingWindow = createDesktopFloatingWindowMock();
    const Provider = createClientVfsExplorerProviderMock();

    render(<InlineUnlock description="files" />);
    expect(screen.getByTestId('inline-unlock')).toHaveTextContent(
      'Unlock files'
    );

    render(
      <FloatingWindow>
        <span>child</span>
      </FloatingWindow>
    );
    expect(screen.getByTestId('floating-window')).toHaveTextContent('child');

    render(
      <Provider>
        <span data-testid="provider-child">ok</span>
      </Provider>
    );
    expect(screen.getByTestId('provider-child')).toBeInTheDocument();
  });

  it('captures props passed into VfsWindow mock', () => {
    const VfsWindowMock = createVfsWindowMock();

    render(
      <VfsWindowMock onUpload={() => undefined} onItemOpen={() => undefined} />
    );

    expect(screen.getByTestId('vfs-window-base')).toBeInTheDocument();
    expect(latestProps).not.toBeNull();
    expect(typeof latestProps?.onUpload).toBe('function');
    expect(typeof latestProps?.onItemOpen).toBe('function');
  });

  it('resets shared mocks and seeds database context', () => {
    mockOpenWindow('x');
    mockRequestWindowOpen('files');
    mockResolveFileOpenTarget('id');
    mockResolvePlaylistType('playlist');
    mockHandleUpload();
    mockHandleFileInputChange();
    mockFileInputRef.current = document.createElement('input');

    resetAllMocks();

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockRequestWindowOpen).not.toHaveBeenCalled();
    expect(mockResolveFileOpenTarget).not.toHaveBeenCalled();
    expect(mockResolvePlaylistType).not.toHaveBeenCalled();
    expect(mockHandleUpload).not.toHaveBeenCalled();
    expect(mockHandleFileInputChange).not.toHaveBeenCalled();
    expect(mockUseDatabaseContext()).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
  });
});
