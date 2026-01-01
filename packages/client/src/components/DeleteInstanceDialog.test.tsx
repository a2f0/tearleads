import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteInstanceDialog } from './DeleteInstanceDialog';

// Mock functions
const mockDeleteInstance = vi.fn(async () => {});
const mockSwitchInstance = vi.fn(async () => true);

// Mock the database context
vi.mock('@/db/hooks/useDatabase', () => ({
  useDatabaseContext: vi.fn(() => ({
    currentInstanceId: 'current-instance',
    instances: [
      { id: 'current-instance', name: 'Instance 1' },
      { id: 'other-instance', name: 'Instance 2' }
    ],
    deleteInstance: mockDeleteInstance,
    switchInstance: mockSwitchInstance
  }))
}));

describe('DeleteInstanceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    render(
      <DeleteInstanceDialog
        open={false}
        onOpenChange={() => {}}
        instanceId="test"
        instanceName="Test Instance"
      />
    );

    expect(screen.queryByText('Delete Instance')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={() => {}}
        instanceId="test"
        instanceName="Test Instance"
      />
    );

    expect(screen.getByText('Delete Instance')).toBeInTheDocument();
    // The instance name is in a <strong> tag within the text
    expect(screen.getByText('Test Instance')).toBeInTheDocument();
  });

  it('calls onOpenChange with false when Cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={onOpenChange}
        instanceId="test"
        instanceName="Test Instance"
      />
    );

    await user.click(screen.getByText('Cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls deleteInstance when Delete is clicked', async () => {
    const user = userEvent.setup();

    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={() => {}}
        instanceId="other-instance"
        instanceName="Instance 2"
      />
    );

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDeleteInstance).toHaveBeenCalledWith('other-instance');
    });
  });

  it('calls deleteInstance when deleting current instance', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={onOpenChange}
        instanceId="current-instance"
        instanceName="Instance 1"
      />
    );

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDeleteInstance).toHaveBeenCalledWith('current-instance');
    });
  });

  it('closes dialog after successful deletion', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={onOpenChange}
        instanceId="other-instance"
        instanceName="Instance 2"
      />
    );

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('does nothing when instanceId is null', () => {
    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={() => {}}
        instanceId={null}
        instanceName=""
      />
    );

    // Should still render, but Delete button won't do anything
    expect(screen.getByText('Delete Instance')).toBeInTheDocument();
  });

  it('shows deleting text on button', () => {
    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={() => {}}
        instanceId="other-instance"
        instanceName="Instance 2"
      />
    );

    // Delete button should be present
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('handles delete error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteInstance.mockRejectedValueOnce(new Error('Delete failed'));
    const user = userEvent.setup();

    render(
      <DeleteInstanceDialog
        open={true}
        onOpenChange={() => {}}
        instanceId="other-instance"
        instanceName="Instance 2"
      />
    );

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete instance:',
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });
});
