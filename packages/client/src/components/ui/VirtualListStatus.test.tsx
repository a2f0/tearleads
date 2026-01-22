import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VirtualListStatus } from './VirtualListStatus';

describe('VirtualListStatus', () => {
  describe('with visible range', () => {
    it('renders viewing range for simple list', () => {
      render(
        <VirtualListStatus
          firstVisible={0}
          lastVisible={9}
          loadedCount={100}
          itemLabel="contact"
        />
      );

      expect(
        screen.getByText('Viewing 1-10 of 100 contacts')
      ).toBeInTheDocument();
    });

    it('renders singular item label correctly', () => {
      render(
        <VirtualListStatus
          firstVisible={0}
          lastVisible={0}
          loadedCount={1}
          itemLabel="contact"
        />
      );

      expect(screen.getByText('Viewing 1-1 of 1 contact')).toBeInTheDocument();
    });

    it('renders with search query suffix', () => {
      render(
        <VirtualListStatus
          firstVisible={0}
          lastVisible={4}
          loadedCount={5}
          itemLabel="contact"
          searchQuery="john"
        />
      );

      expect(
        screen.getByText('Viewing 1-5 of 5 contacts found')
      ).toBeInTheDocument();
    });
  });

  describe('with pagination (Redis-style)', () => {
    it('renders loaded vs total count with range', () => {
      render(
        <VirtualListStatus
          firstVisible={0}
          lastVisible={49}
          loadedCount={50}
          totalCount={1000}
          itemLabel="key"
        />
      );

      expect(
        screen.getByText('Viewing 1-50 of 50 loaded (1,000 total)')
      ).toBeInTheDocument();
    });

    it('renders hasMore indicator when no range', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={50}
          totalCount={1000}
          hasMore={true}
          itemLabel="key"
        />
      );

      expect(screen.getByText('50 loaded+ of 1,000 total')).toBeInTheDocument();
    });

    it('renders hasMore indicator in viewing range format', () => {
      render(
        <VirtualListStatus
          firstVisible={0}
          lastVisible={49}
          loadedCount={50}
          hasMore={true}
          itemLabel="key"
        />
      );

      expect(screen.getByText('Viewing 1-50 of 50+ keys')).toBeInTheDocument();
    });

    it('renders without hasMore indicator when all loaded', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={50}
          totalCount={50}
          hasMore={false}
          itemLabel="key"
        />
      );

      // When totalCount equals loadedCount, it falls through to simple case
      expect(screen.getByText('50 keys')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('renders zero items correctly', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={0}
          itemLabel="document"
        />
      );

      expect(screen.getByText('0 documents')).toBeInTheDocument();
    });

    it('renders zero items with search query', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={0}
          itemLabel="contact"
          searchQuery="xyz"
        />
      );

      expect(screen.getByText('0 contacts found')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(
        <VirtualListStatus
          firstVisible={0}
          lastVisible={9}
          loadedCount={100}
          itemLabel="item"
          className="mb-2"
        />
      );

      const element = screen.getByText('Viewing 1-10 of 100 items');
      expect(element).toHaveClass('mb-2');
      expect(element).toHaveClass('text-muted-foreground');
      expect(element).toHaveClass('text-sm');
    });

    it('uses default item label', () => {
      render(
        <VirtualListStatus firstVisible={0} lastVisible={4} loadedCount={5} />
      );

      expect(screen.getByText('Viewing 1-5 of 5 items')).toBeInTheDocument();
    });
  });

  describe('fallback states', () => {
    it('renders simple count when no visible range and no total', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={42}
          itemLabel="photo"
        />
      );

      expect(screen.getByText('42 photos')).toBeInTheDocument();
    });

    it('renders with hasMore indicator in simple case', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={50}
          hasMore={true}
          itemLabel="track"
        />
      );

      expect(screen.getByText('50 tracks+')).toBeInTheDocument();
    });

    it('renders with searchQuery in fallback case', () => {
      render(
        <VirtualListStatus
          firstVisible={null}
          lastVisible={null}
          loadedCount={5}
          itemLabel="result"
          searchQuery="test"
        />
      );

      expect(screen.getByText('5 results found')).toBeInTheDocument();
    });
  });
});
