# Database Encryption Architecture

Rapid uses industry-standard encryption to protect your data at rest. Your password never leaves your device - instead, it's used to derive a 256-bit encryption key using PBKDF2 with 600,000 iterations. This key encrypts your entire SQLite database using platform-native encryption libraries.

```mermaid
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
```

## Key Components

### Key Derivation

PBKDF2-SHA256 with 600,000 iterations transforms your password into a cryptographically secure 256-bit key, following OWASP 2023 recommendations.

### Platform Security

Each platform uses native encryption:

- **SQLCipher** on mobile (iOS/Android)
- **ChaCha20-Poly1305** on desktop (Electron)
- **SQLite3MultipleCiphers** in the browser (WASM)

### Memory Safety

Encryption keys are securely zeroed from memory after use, preventing extraction from memory dumps or swap files.
