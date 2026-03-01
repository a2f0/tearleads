import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoizedWindow } from './MemoizedWindow';
import type { WindowComponentProps } from './windowRendererTypes';

function TestWindowComponent(props: WindowComponentProps) {
  return (
    <div data-testid="test-window" data-zindex={props.zIndex}>
      <span data-testid="initial-width">
        {props.initialDimensions?.width ?? 'none'}
      </span>
      <button type="button" onClick={props.onClose}>
        close
      </button>
      <button
        type="button"
        onClick={() => props.onMinimize({ x: 1, y: 2, width: 3, height: 4 })}
      >
        minimize
      </button>
      <button
        type="button"
        onClick={() =>
          props.onDimensionsChange?.({ x: 5, y: 6, width: 7, height: 8 })
        }
      >
        resize
      </button>
      <button type="button" onClick={() => props.onRename?.('Renamed')}>
        rename
      </button>
      <button type="button" onClick={props.onFocus}>
        focus
      </button>
    </div>
  );
}

describe('MemoizedWindow', () => {
  it('uses window dimensions when no override is provided', () => {
    const onClose = vi.fn();
    const onMinimize = vi.fn();
    const onDimensionsChange = vi.fn();
    const onRename = vi.fn();
    const onFocus = vi.fn();

    render(
      <MemoizedWindow
        window={{
          id: 'notes-1',
          type: 'notes',
          zIndex: 10,
          isMinimized: false,
          dimensions: { x: 11, y: 22, width: 333, height: 444 }
        }}
        config={{ Component: TestWindowComponent }}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onRename={onRename}
        onFocus={onFocus}
      />
    );

    expect(screen.getByTestId('initial-width')).toHaveTextContent('333');
  });

  it('uses override dimensions and forwards all callbacks with window identity', () => {
    const onClose = vi.fn();
    const onMinimize = vi.fn();
    const onDimensionsChange = vi.fn();
    const onRename = vi.fn();
    const onFocus = vi.fn();

    render(
      <MemoizedWindow
        window={{
          id: 'notes-2',
          type: 'notes',
          zIndex: 20,
          isMinimized: false
        }}
        config={{
          Component: TestWindowComponent,
          getInitialDimensions: () => ({
            x: 100,
            y: 200,
            width: 555,
            height: 666
          })
        }}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onRename={onRename}
        onFocus={onFocus}
      />
    );

    expect(screen.getByTestId('initial-width')).toHaveTextContent('555');
    fireEvent.click(screen.getByText('close'));
    fireEvent.click(screen.getByText('minimize'));
    fireEvent.click(screen.getByText('resize'));
    fireEvent.click(screen.getByText('rename'));
    fireEvent.click(screen.getByText('focus'));

    expect(onClose).toHaveBeenCalledWith('notes-2');
    expect(onMinimize).toHaveBeenCalledWith('notes-2', {
      x: 1,
      y: 2,
      width: 3,
      height: 4
    });
    expect(onDimensionsChange).toHaveBeenCalledWith('notes', 'notes-2', {
      x: 5,
      y: 6,
      width: 7,
      height: 8
    });
    expect(onRename).toHaveBeenCalledWith('notes-2', 'Renamed');
    expect(onFocus).toHaveBeenCalledWith('notes-2');
  });
});
