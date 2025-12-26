import { Footer, ThemeSwitcher } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';

function App() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Rapid" className="h-8 w-8" />
            <h1 className="font-bold text-2xl">Rapid</h1>
          </div>
          <ThemeSwitcher />
        </div>
      </header>
      <main className="flex-1 pb-20">
        <div className="container mx-auto px-4 py-16">
          <h2 className="font-bold text-4xl">Welcome to Rapid</h2>
          <p className="mt-4 text-muted-foreground">
            Your marketing content goes here.
          </p>
        </div>
      </main>
      <Footer
        version={undefined}
        copyrightText={`\u00A9 ${new Date().getFullYear()} Rapid. All rights reserved.`}
      />
    </div>
  );
}

export default App;
