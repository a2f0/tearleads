/**
 * Home page "Open in Window" tests.
 */

import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { setupScreensaverMock } from '@/test/screensaverMock';
import { Home } from './Home';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockGetSetting = vi.fn();

vi.mock('@tearleads/settings', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: vi.fn()
  })
}));

setupScreensaverMock();

function renderHome() {
  return render(
    <ThemeProvider>
      <WindowManagerProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </WindowManagerProvider>
    </ThemeProvider>
  );
}

describe('Home Open in Window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSetting.mockImplementation((key: string) => {
      switch (key) {
        case 'desktopPattern':
          return 'solid';
        case 'desktopIconDepth':
          return 'debossed';
        case 'desktopIconBackground':
          return 'colored';
        default:
          return 'enabled';
      }
    });
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('shows Open in Window option for Notes icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const notesButton = screen.getByRole('button', { name: 'Notes' });
    await user.pointer({ keys: '[MouseRight]', target: notesButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Console icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Email icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const emailButton = screen.getByRole('button', { name: 'Email' });
    await user.pointer({ keys: '[MouseRight]', target: emailButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Files icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Models icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const modelsButton = screen.getByRole('button', { name: 'Models' });
    await user.pointer({ keys: '[MouseRight]', target: modelsButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Debug icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const debugButton = screen.getByRole('button', { name: 'Debug' });
    await user.pointer({ keys: '[MouseRight]', target: debugButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens console in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('opens debug in floating window from context menu', async () => {
    const user = userEvent.setup();
    renderHome();

    const debugButton = screen.getByRole('button', { name: 'Debug' });
    await user.pointer({ keys: '[MouseRight]', target: debugButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('opens notes in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const notesButton = screen.getByRole('button', { name: 'Notes' });
    await user.pointer({ keys: '[MouseRight]', target: notesButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for Settings icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    await user.pointer({ keys: '[MouseRight]', target: settingsButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens settings in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    await user.pointer({ keys: '[MouseRight]', target: settingsButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('opens files in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for SQLite icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const sqliteButton = screen.getByRole('button', { name: 'SQLite' });
    await user.pointer({ keys: '[MouseRight]', target: sqliteButton });

    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens sqlite in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const sqliteButton = screen.getByRole('button', { name: 'SQLite' });
    await user.pointer({ keys: '[MouseRight]', target: sqliteButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for Contacts icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    await user.pointer({ keys: '[MouseRight]', target: contactsButton });

    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens contacts in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    await user.pointer({ keys: '[MouseRight]', target: contactsButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });
});
