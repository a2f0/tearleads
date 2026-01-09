import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisKeyRow } from './RedisKeyRow';

const mockGetValue = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      redis: {
        getValue: (key: string) => mockGetValue(key)
      }
    }
  }
}));

describe('RedisKeyRow', () => {
  const defaultProps = {
    keyInfo: { key: 'test:key', type: 'string', ttl: -1 },
    isExpanded: false,
    onToggle: vi.fn()
  };

  beforeEach(() => {
    mockGetValue.mockReset();
  });

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

    it('shows details when expanded', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test:key',
        type: 'string',
        ttl: -1,
        value: 'test value'
      });

      render(<RedisKeyRow {...defaultProps} isExpanded={true} />);

      expect(screen.getByText(/Key:/)).toBeInTheDocument();
      expect(screen.getByText(/Type:/)).toBeInTheDocument();
      expect(screen.getByText(/TTL:/)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('test value')).toBeInTheDocument();
      });
    });

    it('shows full TTL in seconds when expanded', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test',
        type: 'string',
        ttl: 3600,
        value: 'test value'
      });

      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test', type: 'string', ttl: 3600 }}
          isExpanded={true}
        />
      );

      expect(screen.getByText('3600 seconds')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('test value')).toBeInTheDocument();
      });
    });
  });

  describe('value fetching', () => {
    it('shows loading state when fetching value', async () => {
      mockGetValue.mockImplementation(() => new Promise(() => {}));

      render(<RedisKeyRow {...defaultProps} isExpanded={true} />);

      expect(screen.getByText('Loading value...')).toBeInTheDocument();
    });

    it('fetches value when expanded', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test:key',
        type: 'string',
        ttl: -1,
        value: 'hello world'
      });

      render(<RedisKeyRow {...defaultProps} isExpanded={true} />);

      await waitFor(() => {
        expect(mockGetValue).toHaveBeenCalledWith('test:key');
        expect(screen.getByText('hello world')).toBeInTheDocument();
      });
    });

    it('does not fetch value when collapsed', () => {
      render(<RedisKeyRow {...defaultProps} isExpanded={false} />);

      expect(mockGetValue).not.toHaveBeenCalled();
    });

    it('shows error message when fetch fails', async () => {
      mockGetValue.mockRejectedValue(new Error('Connection refused'));

      render(<RedisKeyRow {...defaultProps} isExpanded={true} />);

      await waitFor(() => {
        expect(
          screen.getByText('Error: Connection refused')
        ).toBeInTheDocument();
      });
    });
  });

  describe('string value display', () => {
    it('displays string value', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test:key',
        type: 'string',
        ttl: -1,
        value: 'hello world'
      });

      render(<RedisKeyRow {...defaultProps} isExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Value:')).toBeInTheDocument();
        expect(screen.getByText('hello world')).toBeInTheDocument();
      });
    });
  });

  describe('set value display', () => {
    it('displays set members with count', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test:set',
        type: 'set',
        ttl: -1,
        value: ['member1', 'member2', 'member3']
      });

      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test:set', type: 'set', ttl: -1 }}
          isExpanded={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Members (3):')).toBeInTheDocument();
        expect(screen.getByText('member1')).toBeInTheDocument();
        expect(screen.getByText('member2')).toBeInTheDocument();
        expect(screen.getByText('member3')).toBeInTheDocument();
      });
    });
  });

  describe('hash value display', () => {
    it('displays hash fields with count', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test:hash',
        type: 'hash',
        ttl: -1,
        value: { field1: 'value1', field2: 'value2' }
      });

      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test:hash', type: 'hash', ttl: -1 }}
          isExpanded={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Fields (2):')).toBeInTheDocument();
        expect(screen.getByText('field1')).toBeInTheDocument();
        expect(screen.getByText('value1')).toBeInTheDocument();
        expect(screen.getByText('field2')).toBeInTheDocument();
        expect(screen.getByText('value2')).toBeInTheDocument();
      });
    });
  });

  describe('unsupported types', () => {
    it('shows message for unsupported types', async () => {
      mockGetValue.mockResolvedValue({
        key: 'test:list',
        type: 'list',
        ttl: -1,
        value: null
      });

      render(
        <RedisKeyRow
          {...defaultProps}
          keyInfo={{ key: 'test:list', type: 'list', ttl: -1 }}
          isExpanded={true}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByText('Value display not supported for this type')
        ).toBeInTheDocument();
      });
    });
  });
});
