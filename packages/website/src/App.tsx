import { Footer, ThemeSwitcher } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { EncryptionDiagram } from './components/EncryptionDiagram';

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

        <section className="container mx-auto px-4 py-8">
          <h2 className="mb-4 font-bold text-3xl">
            Database Encryption Architecture
          </h2>
          <p className="mb-8 max-w-3xl text-muted-foreground">
            Rapid uses industry-standard encryption to protect your data at
            rest. Your password never leaves your device - instead, it's used to
            derive a 256-bit encryption key using PBKDF2 with 600,000
            iterations. This key encrypts your entire SQLite database using
            platform-native encryption libraries.
          </p>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <EncryptionDiagram />
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 font-semibold text-lg">Key Derivation</h3>
              <p className="text-muted-foreground text-sm">
                PBKDF2-SHA256 with 600,000 iterations transforms your password
                into a cryptographically secure 256-bit key, following OWASP
                2023 recommendations.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 font-semibold text-lg">Platform Security</h3>
              <p className="text-muted-foreground text-sm">
                Each platform uses native encryption: SQLCipher on mobile,
                ChaCha20-Poly1305 on desktop, and SQLite3MultipleCiphers in the
                browser.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 font-semibold text-lg">Memory Safety</h3>
              <p className="text-muted-foreground text-sm">
                Encryption keys are securely zeroed from memory after use,
                preventing extraction from memory dumps or swap files.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer
        version={undefined}
        copyrightText={`\u00A9 ${new Date().getFullYear()} Rapid. All rights reserved.`}
      />
    </div>
  );
}

export default App;
