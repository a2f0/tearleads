import { Footer } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { Bug, Database, Settings, Table2, Users } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { AccountSwitcher } from './components/AccountSwitcher';
import { Sidebar } from './components/Sidebar';
import { useAppVersion } from './hooks/useAppVersion';

const navLinkClassName =
  'inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground';

function App() {
  const version = useAppVersion();

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
            <div className="flex items-center gap-1 lg:hidden">
              <Link
                to="/contacts"
                className={navLinkClassName}
                aria-label="Contacts"
                data-testid="contacts-link"
              >
                <Users className="h-5 w-5" />
              </Link>
              <Link
                to="/tables"
                className={navLinkClassName}
                aria-label="Tables"
                data-testid="tables-link"
              >
                <Table2 className="h-5 w-5" />
              </Link>
              <Link
                to="/sqlite"
                className={navLinkClassName}
                aria-label="SQLite"
                data-testid="sqlite-link"
              >
                <Database className="h-5 w-5" />
              </Link>
              <Link
                to="/debug"
                className={navLinkClassName}
                aria-label="Debug"
                data-testid="debug-link"
              >
                <Bug className="h-5 w-5" />
              </Link>
              <Link
                to="/settings"
                className={navLinkClassName}
                aria-label="Settings"
                data-testid="settings-link"
              >
                <Settings className="h-5 w-5" />
              </Link>
            </div>
            <AccountSwitcher />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 pb-20">
          <div className="container mx-auto max-w-2xl px-4 pb-16 lg:max-w-none lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
      <Footer version={version} className="lg:left-64">
        <p>&copy; {new Date().getFullYear()} Tearleads. All rights reserved.</p>
      </Footer>
    </div>
  );
}

export default App;
