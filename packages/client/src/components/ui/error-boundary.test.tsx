import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, errorBoundaryRef } from './error-boundary';

function SafeComponent() {
  return <div>Safe content</div>;
}

// Component that throws when triggered
function ThrowOnClick({ message }: { message: string }) {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error(message);
  }

  return (
    <button type="button" onClick={() => setShouldThrow(true)}>
      Trigger error
    </button>
  );
}

describe('ErrorBoundary', () => {
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Safe content')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-bar')).not.toBeInTheDocument();
  });

  it('displays error bar when child throws on interaction', async () => {
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <ThrowOnClick message="Test error message" />
      </ErrorBoundary>
    );

    await user.click(screen.getByText('Trigger error'));

    const errorBar = screen.getByTestId('error-boundary-bar');
    expect(errorBar).toBeInTheDocument();
    expect(errorBar).toHaveTextContent('Test error message');
  });

  it('shows error bar with red background styling', async () => {
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <ThrowOnClick message="Styled error" />
      </ErrorBoundary>
    );

    await user.click(screen.getByText('Trigger error'));

    const errorBar = screen.getByTestId('error-boundary-bar');
    expect(errorBar).toHaveClass('bg-red-600');
    expect(errorBar).toHaveClass('fixed', 'bottom-0');
  });

  it('clears error when dismiss button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <ThrowOnClick message="Dismissable error" />
      </ErrorBoundary>
    );

    await user.click(screen.getByText('Trigger error'));
    expect(screen.getByTestId('error-boundary-bar')).toBeInTheDocument();

    await user.click(screen.getByTestId('error-boundary-dismiss'));
    expect(screen.queryByTestId('error-boundary-bar')).not.toBeInTheDocument();
  });

  it('exposes setError via errorBoundaryRef after mount', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );

    expect(errorBoundaryRef.current).not.toBeNull();
    expect(errorBoundaryRef.current?.setError).toBeInstanceOf(Function);
    expect(errorBoundaryRef.current?.clearError).toBeInstanceOf(Function);
  });

  it('clears errorBoundaryRef on unmount when it owns the ref', () => {
    const { unmount } = render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );

    expect(errorBoundaryRef.current).not.toBeNull();
    unmount();
    expect(errorBoundaryRef.current).toBeNull();
  });

  it('preserves errorBoundaryRef when a different handler is set', () => {
    const { unmount } = render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );

    const alternateRef = {
      setError: vi.fn(),
      clearError: vi.fn()
    };

    Reflect.set(errorBoundaryRef, 'current', alternateRef);

    unmount();
    expect(errorBoundaryRef.current).toBe(alternateRef);
    Reflect.set(errorBoundaryRef, 'current', null);
  });

  it('displays error when setError is called via ref', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );

    act(() => {
      errorBoundaryRef.current?.setError(new Error('Async error from GPU'));
    });

    const errorBar = screen.getByTestId('error-boundary-bar');
    expect(errorBar).toBeInTheDocument();
    expect(errorBar).toHaveTextContent('Async error from GPU');
  });

  it('clears error when clearError is called via ref', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );

    act(() => {
      errorBoundaryRef.current?.setError(new Error('Error to clear'));
    });
    expect(screen.getByTestId('error-boundary-bar')).toBeInTheDocument();

    act(() => {
      errorBoundaryRef.current?.clearError();
    });
    expect(screen.queryByTestId('error-boundary-bar')).not.toBeInTheDocument();
  });
});
