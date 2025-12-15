import { Footer, ThemeSwitcher } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { DebugMenu } from '@/components/ui/debug-menu';

function App() {
  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      data-testid="app-container"
    >
      <main className="flex-1 pb-20">
        <div className="container mx-auto px-4 py-16 max-w-2xl">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Tearleads" className="h-8 w-8" />
              <h1 className="text-4xl font-bold tracking-tight">Tearleads</h1>
            </div>
            <ThemeSwitcher />
          </div>
        </div>
      </main>
      <Footer>
        <p>&copy; {new Date().getFullYear()} Tearleads. All rights reserved.</p>
      </Footer>
      <DebugMenu />
    </div>
  );
}

export default App;
