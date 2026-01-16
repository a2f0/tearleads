import { ConnectionIndicator, Footer } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';
import { AccountSwitcher } from './components/AccountSwitcher';
import { MiniPlayer } from './components/audio/MiniPlayer';
import { HUDTrigger } from './components/hud';
import { MobileMenu } from './components/MobileMenu';
import { SettingsButton } from './components/SettingsButton';
import { Sidebar } from './components/Sidebar';
import { useAppVersion } from './hooks/useAppVersion';
import { useSSEContext } from './sse';

const sseTooltipKeys = {
  connected: 'sseConnected',
  connecting: 'sseConnecting',
  disconnected: 'sseDisconnected'
} as const;

function App() {
  const { t } = useTranslation('tooltips');
  const version = useAppVersion();
  const sse = useSSEContext();

  return (
    <div
      className="safe-area-inset flex min-h-screen flex-col bg-background"
      data-testid="app-container"
    >
      <header className="w-full px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3">
              <img src={logo} alt="Tearleads" className="h-8 w-8" />
              <h1 className="font-bold text-4xl tracking-tight">Tearleads</h1>
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <MobileMenu />
            <SettingsButton />
            <AccountSwitcher />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col pb-20">
          <div className="container mx-auto flex max-w-2xl flex-1 flex-col px-4 pb-16 lg:max-w-none lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
      <Footer
        version={version}
        className="lg:left-64"
        connectionIndicator={
          sse && (
            <ConnectionIndicator
              state={sse.connectionState}
              tooltip={t(sseTooltipKeys[sse.connectionState])}
            />
          )
        }
        rightAction={<HUDTrigger />}
      >
        <p>&copy; {new Date().getFullYear()} Tearleads. All rights reserved.</p>
      </Footer>
      <MiniPlayer />
    </div>
  );
}

export default App;
