import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftListItem } from '../types';
import { DraftListView } from './DraftListView.js';

const DRAFTS: DraftListItem[] = [
  {
    id: 'draft-1',
    subject: 'Hello World',
    to: ['alice@example.com'],
    updatedAt: '2026-03-12T10:00:00Z'
  },
  {
    id: 'draft-2',
    subject: '',
    to: [],
    updatedAt: '2026-03-11T09:00:00Z'
  }
];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DraftListView', () => {
  describe('loading state', () => {
    it('shows spinner when loading', () => {
      const { container } = render(
        <DraftListView
          drafts={[]}
          loading
          folderName="Drafts"
          viewMode="list"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      expect(
        container.querySelector('.animate-spin')
      ).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no drafts', () => {
      render(
        <DraftListView
          drafts={[]}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      expect(screen.getByText('No emails in Drafts')).toBeInTheDocument();
    });
  });

  describe('list view', () => {
    it('renders draft subjects', () => {
      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      expect(screen.getByText('Hello World')).toBeInTheDocument();
      expect(screen.getByText('(No Subject)')).toBeInTheDocument();
    });

    it('renders recipient info', () => {
      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      expect(
        screen.getByText('To: alice@example.com')
      ).toBeInTheDocument();
      expect(screen.getByText('No recipients')).toBeInTheDocument();
    });

    it('calls onEditDraft when clicking a draft', async () => {
      const user = userEvent.setup();
      const onEditDraft = vi.fn();

      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={onEditDraft}
          onDeleteDraft={vi.fn()}
        />
      );

      await user.click(screen.getByText('Hello World'));
      expect(onEditDraft).toHaveBeenCalledWith('draft-1');
    });

    it('opens context menu on right-click', async () => {
      const user = userEvent.setup();

      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      await user.pointer({
        target: screen.getByText('Hello World'),
        keys: '[MouseRight]'
      });

      expect(
        screen.getByTestId('draft-list-context-menu')
      ).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('calls onEditDraft from context menu Edit', async () => {
      const user = userEvent.setup();
      const onEditDraft = vi.fn();

      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={onEditDraft}
          onDeleteDraft={vi.fn()}
        />
      );

      await user.pointer({
        target: screen.getByText('Hello World'),
        keys: '[MouseRight]'
      });
      await user.click(screen.getByText('Edit'));
      expect(onEditDraft).toHaveBeenCalledWith('draft-1');
    });

    it('calls onDeleteDraft from context menu Delete', async () => {
      const user = userEvent.setup();
      const onDeleteDraft = vi.fn();

      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="list"
          onEditDraft={vi.fn()}
          onDeleteDraft={onDeleteDraft}
        />
      );

      await user.pointer({
        target: screen.getByText('Hello World'),
        keys: '[MouseRight]'
      });
      await user.click(screen.getByText('Delete'));
      expect(onDeleteDraft).toHaveBeenCalledWith('draft-1');
    });
  });

  describe('table view', () => {
    it('renders table headers', () => {
      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="table"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      expect(screen.getByText('Subject')).toBeInTheDocument();
      expect(screen.getByText('To')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    it('renders draft data in table rows', () => {
      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="table"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      expect(screen.getByText('Hello World')).toBeInTheDocument();
      expect(screen.getByText('(No Subject)')).toBeInTheDocument();
      expect(
        screen.getByText('alice@example.com')
      ).toBeInTheDocument();
      expect(screen.getByText('No recipients')).toBeInTheDocument();
    });

    it('calls onEditDraft when clicking a table row', async () => {
      const user = userEvent.setup();
      const onEditDraft = vi.fn();

      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="table"
          onEditDraft={onEditDraft}
          onDeleteDraft={vi.fn()}
        />
      );

      await user.click(screen.getByText('Hello World'));
      expect(onEditDraft).toHaveBeenCalledWith('draft-1');
    });

    it('opens context menu on right-click in table view', async () => {
      const user = userEvent.setup();

      render(
        <DraftListView
          drafts={DRAFTS}
          loading={false}
          folderName="Drafts"
          viewMode="table"
          onEditDraft={vi.fn()}
          onDeleteDraft={vi.fn()}
        />
      );

      await user.pointer({
        target: screen.getByText('Hello World'),
        keys: '[MouseRight]'
      });

      expect(
        screen.getByTestId('draft-list-context-menu')
      ).toBeInTheDocument();
    });
  });
});
