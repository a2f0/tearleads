import { createElement, type ReactNode } from 'react';

interface InitialDimensions {
  width: number;
  height: number;
  x: number;
  y: number;
}

interface FloatingWindowProps {
  children: ReactNode;
  title: string;
  onClose: () => void;
  initialDimensions?: InitialDimensions;
}

interface ChildrenProps {
  children: ReactNode;
}

interface ControlButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  'data-testid'?: string;
}

export function DesktopFloatingWindow({
  children,
  title,
  onClose,
  initialDimensions
}: FloatingWindowProps) {
  return createElement(
    'div',
    {
      'data-testid': 'floating-window',
      'data-initial-dimensions': initialDimensions
        ? JSON.stringify(initialDimensions)
        : undefined
    },
    createElement('div', { 'data-testid': 'window-title' }, title),
    createElement(
      'button',
      {
        type: 'button',
        onClick: onClose,
        'data-testid': 'close-window'
      },
      'Close'
    ),
    children
  );
}

export function WindowMenuBar({ children }: ChildrenProps) {
  return createElement('div', { 'data-testid': 'window-menu-bar' }, children);
}

export function WindowControlBar({ children }: ChildrenProps) {
  return createElement(
    'div',
    { 'data-testid': 'window-control-bar' },
    children
  );
}

export function WindowControlGroup({ children }: ChildrenProps) {
  return createElement(
    'div',
    { 'data-testid': 'window-control-group' },
    children
  );
}

export function WindowControlButton({
  children,
  icon,
  onClick,
  'data-testid': dataTestId
}: ControlButtonProps) {
  return createElement(
    'button',
    {
      type: 'button',
      onClick,
      'data-testid': dataTestId
    },
    icon,
    children
  );
}

export const windowManagerTestMock = {
  DesktopFloatingWindow,
  WindowMenuBar,
  WindowControlBar,
  WindowControlGroup,
  WindowControlButton
};
