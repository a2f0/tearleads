import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emitInstanceChange,
  resetInstanceChangeState
} from '@/hooks/useInstanceChange';
import { InstanceChangeHandler } from './InstanceChangeHandler';

const mockResetLLMUIState = vi.fn();
const mockClearAttachedImage = vi.fn();

vi.mock('@/hooks/useLLM', () => ({
  resetLLMUIState: () => mockResetLLMUIState()
}));

vi.mock('@/lib/llm-runtime', () => ({
  clearAttachedImage: () => mockClearAttachedImage()
}));

describe('InstanceChangeHandler', () => {
  beforeEach(() => {
    resetInstanceChangeState();
    mockResetLLMUIState.mockClear();
    mockClearAttachedImage.mockClear();
  });

  it('does not reset when there is no previous instance', () => {
    render(<InstanceChangeHandler />);

    act(() => {
      emitInstanceChange('instance-1');
    });

    expect(mockResetLLMUIState).not.toHaveBeenCalled();
    expect(mockClearAttachedImage).not.toHaveBeenCalled();
  });

  it('resets state when switching between instances', () => {
    render(<InstanceChangeHandler />);

    act(() => {
      emitInstanceChange('instance-1');
    });

    act(() => {
      emitInstanceChange('instance-2');
    });

    expect(mockResetLLMUIState).toHaveBeenCalledTimes(1);
    expect(mockClearAttachedImage).toHaveBeenCalledTimes(1);
  });
});
