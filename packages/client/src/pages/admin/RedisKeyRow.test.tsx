import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RedisKeyRow } from './RedisKeyRow';

describe('RedisKeyRow', () => {
  const defaultProps = {
    keyInfo: { key: 'test:key', type: 'string', ttl: -1 },
    isExpanded: false,
    onToggle: vi.fn()
  };

  describe('rendering', () => {
    it('displays key name', () => {
      render(<RedisKeyRow {...defaultProps} />);

      expect(screen.getByText('test:key')).toBeInTheDocument();
    });

    it('displays key type badge', () => {
      render(<RedisKeyRow {...defaultProps} />);

      expect(screen.getByText('string')).toBeInTheDocument();
    });

    it('displays "No expiry" for ttl -1', () => {
      render(<RedisKeyRow {...defaultProps} />);

      expect(screen.getByText('No expiry')).toBeInTheDocument();
    });

    it('displays formatted TTL in seconds', () => {
      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type: 'string', ttl: 30 }}
        />
      );

      expect(screen.getByText('30s')).toBeInTheDocument();
    });

    it('displays formatted TTL in minutes', () => {
      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type: 'string', ttl: 120 }}
        />
      );

      expect(screen.getByText('2m')).toBeInTheDocument();
    });

    it('displays formatted TTL in hours', () => {
      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type: 'string', ttl: 7200 }}
        />
      );

      expect(screen.getByText('2h')).toBeInTheDocument();
    });

    it('displays formatted TTL in days', () => {
      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type: 'string', ttl: 172800 }}
        />
      );

      expect(screen.getByText('2d')).toBeInTheDocument();
    });
  });

  describe('type badges', () => {
    it.each([
      ['string', 'blue'],
      ['list', 'green'],
      ['set', 'purple'],
      ['hash', 'orange'],
      ['zset', 'pink'],
      ['stream', 'cyan']
    ])('renders %s type with appropriate styling', (type) => {
      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type, ttl: -1 }}
        />
      );

      expect(screen.getByText(type)).toBeInTheDocument();
    });
  });

  describe('expand/collapse', () => {
    it('calls onToggle when clicked', async () => {
      const onToggle = vi.fn();
      const user = userEvent.setup();

      render(<RedisKeyRow {...defaultProps} onToggle={onToggle} />);

      await user.click(screen.getByRole('button'));

      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does not show details when collapsed', () => {
      render(<RedisKeyRow {...defaultProps} isExpanded={false} />);

      expect(screen.queryByText(/Key:/)).not.toBeInTheDocument();
    });

    it('shows details when expanded', () => {
      render(<RedisKeyRow {...defaultProps} isExpanded={true} />);

      expect(screen.getByText(/Key:/)).toBeInTheDocument();
      expect(screen.getByText(/Type:/)).toBeInTheDocument();
      expect(screen.getByText(/TTL:/)).toBeInTheDocument();
    });

    it('shows full TTL in seconds when expanded', () => {
      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type: 'string', ttl: 3600 }}
          isExpanded={true}
        />
      );

      expect(screen.getByText('3600 seconds')).toBeInTheDocument();
    });
  });
});
