import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WindowRenderer } from './components/window-renderer';

const renderSpy = vi.hoisted(() => vi.fn());

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: vi.fn(() => ({ render: renderSpy }))
  }
}));

vi.mock('./lib/console-error-capture', () => ({
  installConsoleErrorCapture: vi.fn()
}));

function analyzeTree(node: React.ReactNode) {
  const result = {
    hasBrowserRouter: false,
    hasWindowRenderer: false,
    hasWindowRendererInRouter: false
  };

  const visit = (current: React.ReactNode, inRouter: boolean) => {
    if (!current) return;
    if (Array.isArray(current)) {
      current.forEach((child) => visit(child, inRouter));
      return;
    }
    if (!React.isValidElement(current)) return;

    const isRouter = current.type === BrowserRouter;
    const nextInRouter = inRouter || isRouter;

    if (isRouter) result.hasBrowserRouter = true;
    if (current.type === WindowRenderer) {
      result.hasWindowRenderer = true;
      if (nextInRouter) result.hasWindowRendererInRouter = true;
    }

    visit(current.props.children, nextInRouter);
  };

  visit(node, false);
  return result;
}

describe('main', () => {
  it('keeps WindowRenderer outside BrowserRouter', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    renderSpy.mockClear();

    await import('./main');

    expect(renderSpy).toHaveBeenCalled();
    const rootElement = renderSpy.mock.calls[0][0];
    const result = analyzeTree(rootElement);

    expect(result.hasBrowserRouter).toBe(true);
    expect(result.hasWindowRenderer).toBe(true);
    expect(result.hasWindowRendererInRouter).toBe(false);
  });
});
