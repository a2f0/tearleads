import { Footer } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { Bug, FileIcon, Settings, Table2 } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';

function App() {
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
            <Link
              to="/files"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              aria-label="Files"
              data-testid="files-link"
            >
              <FileIcon className="h-5 w-5" />
            </Link>
            <Link
              to="/tables"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              aria-label="Tables"
              data-testid="tables-link"
            >
              <Table2 className="h-5 w-5" />
            </Link>
            <Link
              to="/debug"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              aria-label="Debug"
              data-testid="debug-link"
            >
              <Bug className="h-5 w-5" />
            </Link>
            <Link
              to="/settings"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              aria-label="Settings"
              data-testid="settings-link"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 pb-20">
        <div className="container mx-auto max-w-2xl px-4 pb-16">
          <Outlet />
        </div>
      </main>
      <Footer version={undefined}>
        <p>&copy; {new Date().getFullYear()} Tearleads. All rights reserved.</p>
      </Footer>
    </div>
  );
}

export default App;
