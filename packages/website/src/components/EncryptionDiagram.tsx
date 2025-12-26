import mermaid from 'mermaid';
import { useEffect, useId, useState } from 'react';

const ENCRYPTION_DIAGRAM = `
flowchart TB
    subgraph UserAuth["User Authentication"]
        PWD["User Password"]
        SALT["Random Salt<br/>(32 bytes)"]
    end

    subgraph KeyDerivation["Key Derivation (PBKDF2)"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterations"]
        KEY["256-bit AES Key"]
    end

    subgraph Verification["Password Verification"]
        KCV["Key Check Value<br/>(AES-GCM encrypted)"]
        STORE["Secure Storage<br/>• IndexedDB (Web)<br/>• Keychain (iOS)<br/>• EncryptedPrefs (Android)<br/>• File System (Electron)"]
    end

    subgraph PlatformEncryption["Platform-Specific Database Encryption"]
        direction LR
        ELECTRON["Electron<br/>ChaCha20-Poly1305"]
        WEB["Web<br/>SQLite3MultipleCiphers<br/>(WASM)"]
        MOBILE["iOS/Android<br/>SQLCipher"]
    end

    subgraph Database["Encrypted Database"]
        DB[("SQLite Database<br/>Fully Encrypted at Rest")]
    end

    subgraph Security["Memory Security"]
        ZERO["Secure Buffer Zeroing<br/>after key use"]
    end

    PWD --> PBKDF2
    SALT --> PBKDF2
    PBKDF2 --> KEY
    KEY --> KCV
    SALT --> STORE
    KCV --> STORE
    KEY --> ELECTRON
    KEY --> WEB
    KEY --> MOBILE
    ELECTRON --> DB
    WEB --> DB
    MOBILE --> DB
    KEY --> ZERO

    classDef default fill:#f8fafc,stroke:#64748b,color:#1e293b
    classDef dark fill:#334155,stroke:#1e293b,color:#f8fafc
    classDef medium fill:#94a3b8,stroke:#475569,color:#0f172a
    classDef light fill:#e2e8f0,stroke:#94a3b8,color:#1e293b

    class PWD,SALT light
    class PBKDF2,KEY dark
    class KCV,STORE medium
    class ELECTRON,WEB,MOBILE light
    class DB dark
    class ZERO medium
`;

export function EncryptionDiagram() {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const diagramId = `mermaid-${id.replace(/:/g, '')}`;

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            primaryColor: '#e2e8f0',
            primaryTextColor: '#1e293b',
            primaryBorderColor: '#64748b',
            lineColor: '#64748b',
            secondaryColor: '#cbd5e1',
            tertiaryColor: '#f1f5f9',
            background: '#ffffff',
            mainBkg: '#f8fafc',
            nodeBorder: '#64748b',
            clusterBkg: '#f8fafc',
            clusterBorder: '#94a3b8',
            titleColor: '#0f172a',
            edgeLabelBackground: '#ffffff'
          },
          flowchart: {
            curve: 'basis',
            padding: 20,
            nodeSpacing: 50,
            rankSpacing: 80,
            htmlLabels: true
          }
        });

        const { svg } = await mermaid.render(diagramId, ENCRYPTION_DIAGRAM);
        if (!cancelled) {
          setSvgContent(svg);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to render diagram'
          );
        }
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagramId]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to render diagram: {error}
      </div>
    );
  }

  if (!svgContent) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <div className="text-muted-foreground">Loading diagram...</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-200"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from trusted Mermaid library
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
