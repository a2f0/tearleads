import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDialogAccessibility } from './useDialogAccessibility';

describe('useDialogAccessibility', () => {
  const createMockRef = () => ({
    current: document.createElement('div')
  });

  it('should return handleKeyDown function', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useDialogAccessibility(mockRef, true, false, onClose)
    );

    expect(result.current.handleKeyDown).toBeDefined();
    expect(typeof result.current.handleKeyDown).toBe('function');
  });

  it('should call onClose when Escape is pressed and not processing', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useDialogAccessibility(mockRef, true, false, onClose)
    );

    const event = {
      key: 'Escape',
      preventDefault: vi.fn()
    } as unknown as React.KeyboardEvent;

    result.current.handleKeyDown(event);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when Escape is pressed while processing', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useDialogAccessibility(mockRef, true, true, onClose)
    );

    const event = {
      key: 'Escape',
      preventDefault: vi.fn()
    } as unknown as React.KeyboardEvent;

    result.current.handleKeyDown(event);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should save and restore focus when dialog opens and closes', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();
    const mockElement = document.createElement('button');
    document.body.appendChild(mockElement);
    mockElement.focus();

    const { rerender } = renderHook(
      ({ open }) => useDialogAccessibility(mockRef, open, false, onClose),
      { initialProps: { open: false } }
    );

    rerender({ open: true });

    rerender({ open: false });

    expect(document.activeElement).toBe(mockElement);

    document.body.removeChild(mockElement);
  });

  it('should trap focus within dialog on Tab key', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();

    const button1 = document.createElement('button');
    const button2 = document.createElement('button');
    mockRef.current.appendChild(button1);
    mockRef.current.appendChild(button2);
    document.body.appendChild(mockRef.current);

    button2.focus();

    const { result } = renderHook(() =>
      useDialogAccessibility(mockRef, true, false, onClose)
    );

    const event = {
      key: 'Tab',
      shiftKey: false,
      preventDefault: vi.fn()
    } as unknown as React.KeyboardEvent;

    result.current.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();

    document.body.removeChild(mockRef.current);
  });

  it('should trap focus backwards on Shift+Tab', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();

    const button1 = document.createElement('button');
    const button2 = document.createElement('button');
    mockRef.current.appendChild(button1);
    mockRef.current.appendChild(button2);
    document.body.appendChild(mockRef.current);

    button1.focus();

    const { result } = renderHook(() =>
      useDialogAccessibility(mockRef, true, false, onClose)
    );

    const event = {
      key: 'Tab',
      shiftKey: true,
      preventDefault: vi.fn()
    } as unknown as React.KeyboardEvent;

    result.current.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();

    document.body.removeChild(mockRef.current);
  });

  it('should not interfere with other keys', () => {
    const mockRef = createMockRef();
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useDialogAccessibility(mockRef, true, false, onClose)
    );

    const event = {
      key: 'Enter',
      preventDefault: vi.fn()
    } as unknown as React.KeyboardEvent;

    result.current.handleKeyDown(event);

    expect(onClose).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
