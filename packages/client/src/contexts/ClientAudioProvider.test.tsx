import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudioAboutMenuItem, ClientAudioProvider } from './ClientAudioProvider';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/lib/navigation', () => ({
  useNavigateWithFrom: () => vi.fn()
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn()
  })
}));

vi.mock('@rapid/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rapid/audio')>();
  return {
    ...actual,
    AudioUIProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="audio-ui-provider">{children}</div>
    )
  };
});

vi.mock('@rapid/audio/package.json', () => ({
  default: { version: '0.0.1' }
}));

vi.mock('@/components/window-menu/AboutMenuItem', () => ({
  AboutMenuItem: ({
    appName,
    version
  }: {
    appName: string;
    version: string;
  }) => (
    <div data-testid="about-menu-item">
      {appName} v{version}
    </div>
  )
}));

describe('ClientAudioProvider', () => {
  it('renders children wrapped in AudioUIProvider', () => {
    render(
      <ClientAudioProvider>
        <div data-testid="child">Test Child</div>
      </ClientAudioProvider>
    );

    expect(screen.getByTestId('audio-ui-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});

describe('AudioAboutMenuItem', () => {
  it('renders AboutMenuItem with correct props', () => {
    render(<AudioAboutMenuItem />);

    expect(screen.getByTestId('about-menu-item')).toHaveTextContent(
      'Audio v0.0.1'
    );
  });
});
