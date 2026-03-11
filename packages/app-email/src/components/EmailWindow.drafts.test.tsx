import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailDraftOperations } from '../context';
import { installEmailWindowModuleMocks } from '../test/emailWindowModuleMocks';
import { defaultProps, renderLoadedWindow } from '../test/emailWindowTestUtils';
import { mockFolderOperations } from './emailWindowTestFixtures';

const mockDraftOperations: EmailDraftOperations = {
  saveDraft: vi
    .fn()
    .mockResolvedValue({ id: 'draft-1', updatedAt: '2024-01-15T10:00:00Z' }),
  getDraft: vi.fn().mockResolvedValue(null),
  fetchDrafts: vi.fn().mockResolvedValue([
    {
      id: 'draft-1',
      to: ['recipient@example.com'],
      subject: 'My Draft Email',
      updatedAt: '2024-01-15T10:00:00Z'
    }
  ]),
  deleteDraft: vi.fn().mockResolvedValue(true)
};

describe('EmailWindow drafts folder', () => {
  beforeEach(() => {
    installEmailWindowModuleMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows drafts when Drafts folder is selected', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow(defaultProps, {
      folderOperations: mockFolderOperations,
      draftOperations: mockDraftOperations
    });
    await user.click(screen.getByText('Drafts'));
    expect(await screen.findByText('My Draft Email')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Drafts');
  });

  it('shows empty state when no drafts exist', async () => {
    const emptyDraftOperations: EmailDraftOperations = {
      ...mockDraftOperations,
      fetchDrafts: vi.fn().mockResolvedValue([])
    };
    const user = userEvent.setup();
    await renderLoadedWindow(defaultProps, {
      folderOperations: mockFolderOperations,
      draftOperations: emptyDraftOperations
    });
    await user.click(screen.getByText('Drafts'));
    expect(await screen.findByText('No emails in Drafts')).toBeInTheDocument();
  });
});
