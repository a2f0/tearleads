import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LazyWindowRenderer } from './components/window-renderer';

const renderSpy = vi.hoisted(() => vi.fn());

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: vi.fn(() => ({ render: renderSpy }))
  }
}));

vi.mock('./lib/consoleErrorCapture', () => ({
  installConsoleErrorCapture: vi.fn()
}));

function analyzeTree(node: React.ReactNode) {
  const result = {
    hasBrowserRouter: false,
    hasLazyWindowRenderer: false,
    hasLazyWindowRendererInRouter: false
  };

  const visit = (current: React.ReactNode, inRouter: boolean) => {
    if (!current) return;
    if (Array.isArray(current)) {
      current.forEach((child) => {
        visit(child, inRouter);
      });
      return;
    }
    if (!React.isValidElement(current)) return;

    const isRouter = current.type === BrowserRouter;
    const nextInRouter = inRouter || isRouter;

    if (isRouter) result.hasBrowserRouter = true;
    if (current.type === LazyWindowRenderer) {
      result.hasLazyWindowRenderer = true;
      if (nextInRouter) result.hasLazyWindowRendererInRouter = true;
    }

    visit(
      (current as React.ReactElement<{ children?: React.ReactNode }>).props
        .children,
      nextInRouter
    );
  };

  visit(node, false);
  return result;
}

describe('main', () => {
  it('keeps LazyWindowRenderer inside BrowserRouter for router hook access', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    renderSpy.mockClear();

    await import('./main');

    expect(renderSpy).toHaveBeenCalled();
    const rootElement = renderSpy.mock.calls[0]?.[0];
    const result = analyzeTree(rootElement);

    expect(result.hasBrowserRouter).toBe(true);
    expect(result.hasLazyWindowRenderer).toBe(true);
    // LazyWindowRenderer must be inside BrowserRouter so window components
    // can use router hooks like useNavigate (e.g., ClientNotesProvider)
    expect(result.hasLazyWindowRendererInRouter).toBe(true);
  });
});
