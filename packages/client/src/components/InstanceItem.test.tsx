import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstanceItem } from './InstanceItem';

const instance = { id: 'instance-1', name: 'Primary Instance' };

describe('InstanceItem', () => {
  it('renders unlocked status when selected and unlocked', () => {
    render(
      <InstanceItem
        instance={instance}
        isSelected
        isUnlocked
        showDeleteButton={false}
        alwaysShowDeleteButton={false}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
  });

  it('renders locked status when not selected', () => {
    render(
      <InstanceItem
        instance={instance}
        isSelected={false}
        isUnlocked={false}
        showDeleteButton={false}
        alwaysShowDeleteButton={false}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('calls onSwitch when clicked or activated with keyboard', () => {
    const onSwitch = vi.fn();
    render(
      <InstanceItem
        instance={instance}
        isSelected={false}
        isUnlocked={false}
        showDeleteButton={false}
        alwaysShowDeleteButton={false}
        onSwitch={onSwitch}
        onDelete={vi.fn()}
      />
    );

    const item = screen.getByTestId('instance-instance-1');
    fireEvent.click(item);
    fireEvent.keyDown(item, { key: 'Enter' });
    fireEvent.keyDown(item, { key: ' ' });

    expect(onSwitch).toHaveBeenCalledTimes(3);
    expect(onSwitch).toHaveBeenCalledWith('instance-1');
  });

  it('ignores unrelated keys for keyboard activation', () => {
    const onSwitch = vi.fn();
    render(
      <InstanceItem
        instance={instance}
        isSelected={false}
        isUnlocked={false}
        showDeleteButton={false}
        alwaysShowDeleteButton={false}
        onSwitch={onSwitch}
        onDelete={vi.fn()}
      />
    );

    const item = screen.getByTestId('instance-instance-1');
    fireEvent.keyDown(item, { key: 'Escape' });

    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('renders and handles delete button when enabled', () => {
    const onDelete = vi.fn();
    render(
      <InstanceItem
        instance={instance}
        isSelected={false}
        isUnlocked={false}
        showDeleteButton
        alwaysShowDeleteButton
        onSwitch={vi.fn()}
        onDelete={onDelete}
      />
    );

    const deleteButton = screen.getByTestId('delete-instance-instance-1');
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[1]).toBe('instance-1');
  });

  it('does not render delete button when disabled', () => {
    render(
      <InstanceItem
        instance={instance}
        isSelected={false}
        isUnlocked={false}
        showDeleteButton={false}
        alwaysShowDeleteButton={false}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('delete-instance-instance-1')
    ).not.toBeInTheDocument();
  });
});
