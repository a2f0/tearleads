/**
 * Test utilities for rendering components with database context.
 * Combines all necessary providers for integration testing.
 */

import { ThemeProvider } from '@rapid/ui';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { render, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TestDatabaseProvider } from './test-database-provider';

export interface RenderWithDatabaseOptions
  extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Initial route for the MemoryRouter.
   * Default: '/'
   */
  initialRoute?: string;
  /**
   * Additional routes for the MemoryRouter.
   * Useful for testing navigation.
   */
  routes?: string[];
  /**
   * Automatically set up and unlock the database.
   * Default: true
   */
  autoSetup?: boolean;
  /**
   * Password for database setup/unlock.
   * Default: 'test-password'
   */
  password?: string;
  /**
   * Whether to wait for the database to be ready before resolving.
   * Default: true
   */
  waitForReady?: boolean;
}

interface RenderWithDatabaseResult extends RenderResult {
  /**
   * The routes passed to MemoryRouter.
   */
  routes: string[];
}

/**
 * Creates a wrapper component with all necessary providers.
 */
function createWrapper({
  initialRoute = '/',
  routes = [],
  autoSetup = true,
  password = 'test-password',
  showLoading = false
}: Omit<RenderWithDatabaseOptions, 'waitForReady'> & {
  showLoading?: boolean;
}): React.FC<{
  children: ReactNode;
}> {
  const initialEntries = routes.length > 0 ? routes : [initialRoute];

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <TestDatabaseProvider
          autoSetup={autoSetup}
          password={password}
          showLoading={showLoading}
        >
          <MemoryRouter initialEntries={initialEntries}>
            {children}
          </MemoryRouter>
        </TestDatabaseProvider>
      </ThemeProvider>
    );
  };
}

/**
 * Render a component with database context and all necessary providers.
 *
 * This is an async function that waits for the database to be ready
 * before returning.
 *
 * Usage:
 * ```tsx
 * const { getByText } = await renderWithDatabase(<MyComponent />);
 * expect(getByText('Hello')).toBeInTheDocument();
 * ```
 *
 * With options:
 * ```tsx
 * const result = await renderWithDatabase(<MyComponent />, {
 *   initialRoute: '/contacts',
 *   autoSetup: true
 * });
 * ```
 */
export async function renderWithDatabase(
  ui: ReactElement,
  options: RenderWithDatabaseOptions = {}
): Promise<RenderWithDatabaseResult> {
  const {
    initialRoute = '/',
    routes = [],
    autoSetup = true,
    password = 'test-password',
    waitForReady = true,
    ...renderOptions
  } = options;

  // Always show loading when waiting for database to be ready
  const wrapper = createWrapper({
    initialRoute,
    routes,
    autoSetup,
    password,
    // Force showLoading so we can detect when setup is complete
    showLoading: waitForReady && autoSetup
  });
  const result = render(ui, { wrapper, ...renderOptions });

  if (waitForReady && autoSetup) {
    // Wait for the database to be ready
    // First, wait for the loading indicator to appear (setup started)
    // Then wait for it to disappear (setup complete) or error to appear
    await waitFor(
      () => {
        const error = result.queryByTestId('test-database-error');
        if (error) {
          throw new Error(`Database setup failed: ${error.textContent}`);
        }
        const loading = result.queryByTestId('test-database-loading');
        if (loading) {
          throw new Error('Database still loading');
        }
        // Neither loading nor error - setup must be complete
      },
      { timeout: 10000 }
    );
  }

  return {
    ...result,
    routes: routes.length > 0 ? routes : [initialRoute]
  };
}

/**
 * Synchronous version that returns immediately without waiting.
 * Useful when you need more control over the async flow.
 */
export function renderWithDatabaseSync(
  ui: ReactElement,
  options: Omit<RenderWithDatabaseOptions, 'waitForReady'> = {}
): RenderResult {
  const {
    initialRoute = '/',
    routes = [],
    autoSetup = true,
    password = 'test-password',
    ...renderOptions
  } = options;

  const wrapper = createWrapper({ initialRoute, routes, autoSetup, password });
  return render(ui, { wrapper, ...renderOptions });
}
