# Database Encryption Architecture

Rapid uses industry-standard encryption to protect your data at rest. Your password never leaves your device - instead, it's used to derive a 256-bit encryption key using PBKDF2 with 600,000 iterations. This key encrypts your entire SQLite database using platform-native encryption libraries.

## Web (Browser)

```mermaid
flowchart TB
    subgraph UserAuth["User Authentication"]
        PWD["User Password"]
        SALT["Random Salt (32 bytes)"]
    end

    subgraph KeyDerivation["Key Derivation"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterations"]
        KEY["256-bit AES Key"]
    end

    subgraph Verification["Password Verification"]
        KCV["Key Check Value<br/>(AES-GCM encrypted)"]
        STORE["IndexedDB<br/>(Browser Storage)"]
    end

    subgraph Encryption["Database Encryption"]
        CIPHER["SQLite3MultipleCiphers<br/>(WASM)"]
    end

    subgraph Database["Encrypted Database"]
        DB[("SQLite Database<br/>Fully Encrypted at Rest")]
    end

    subgraph Security["Memory Security"]
        ZERO["Secure Buffer Zeroing"]
    end

    PWD --> PBKDF2
    SALT --> PBKDF2
    PBKDF2 --> KEY
    KEY --> KCV
    SALT --> STORE
    KCV --> STORE
    KEY --> CIPHER
    CIPHER --> DB
    KEY --> ZERO
```

## Electron (Desktop)

```mermaid
flowchart TB
    subgraph UserAuth["User Authentication"]
        PWD["User Password"]
        SALT["Random Salt (32 bytes)"]
    end

    subgraph KeyDerivation["Key Derivation"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterations"]
        KEY["256-bit Key"]
    end

    subgraph Verification["Password Verification"]
        KCV["Key Check Value<br/>(AES-GCM encrypted)"]
        STORE["File System<br/>(Encrypted Config)"]
    end

    subgraph Encryption["Database Encryption"]
        CIPHER["ChaCha20-Poly1305<br/>(Native Node.js)"]
    end

    subgraph Database["Encrypted Database"]
        DB[("SQLite Database<br/>Fully Encrypted at Rest")]
    end

    subgraph Security["Memory Security"]
        ZERO["Secure Buffer Zeroing"]
    end

    PWD --> PBKDF2
    SALT --> PBKDF2
    PBKDF2 --> KEY
    KEY --> KCV
    SALT --> STORE
    KCV --> STORE
    KEY --> CIPHER
    CIPHER --> DB
    KEY --> ZERO
```

## iOS

```mermaid
flowchart TB
    subgraph UserAuth["User Authentication"]
        PWD["User Password"]
        SALT["Random Salt (32 bytes)"]
    end

    subgraph KeyDerivation["Key Derivation"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterations"]
        KEY["256-bit AES Key"]
    end

    subgraph Verification["Password Verification"]
        KCV["Key Check Value<br/>(AES-GCM encrypted)"]
        STORE["iOS Keychain<br/>(Secure Enclave)"]
    end

    subgraph Encryption["Database Encryption"]
        CIPHER["SQLCipher<br/>(Native iOS)"]
    end

    subgraph Database["Encrypted Database"]
        DB[("SQLite Database<br/>Fully Encrypted at Rest")]
    end

    subgraph Security["Memory Security"]
        ZERO["Secure Buffer Zeroing"]
    end

    PWD --> PBKDF2
    SALT --> PBKDF2
    PBKDF2 --> KEY
    KEY --> KCV
    SALT --> STORE
    KCV --> STORE
    KEY --> CIPHER
    CIPHER --> DB
    KEY --> ZERO
```

## Android

```mermaid
flowchart TB
    subgraph UserAuth["User Authentication"]
        PWD["User Password"]
        SALT["Random Salt (32 bytes)"]
    end

    subgraph KeyDerivation["Key Derivation"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterations"]
        KEY["256-bit AES Key"]
    end

    subgraph Verification["Password Verification"]
        KCV["Key Check Value<br/>(AES-GCM encrypted)"]
        STORE["EncryptedSharedPreferences<br/>(Android Keystore)"]
    end

    subgraph Encryption["Database Encryption"]
        CIPHER["SQLCipher<br/>(Native Android)"]
    end

    subgraph Database["Encrypted Database"]
        DB[("SQLite Database<br/>Fully Encrypted at Rest")]
    end

    subgraph Security["Memory Security"]
        ZERO["Secure Buffer Zeroing"]
    end

    PWD --> PBKDF2
    SALT --> PBKDF2
    PBKDF2 --> KEY
    KEY --> KCV
    SALT --> STORE
    KCV --> STORE
    KEY --> CIPHER
    CIPHER --> DB
    KEY --> ZERO
```

## Key Components

### Key Derivation

PBKDF2-SHA256 with 600,000 iterations transforms your password into a cryptographically secure 256-bit key, following OWASP 2023 recommendations.

### Platform Security

Each platform uses native encryption:

| Platform | Encryption Library              | Secure Storage              |
| -------- | ------------------------------- | --------------------------- |
| Web      | SQLite3MultipleCiphers (WASM)   | IndexedDB                   |
| Electron | ChaCha20-Poly1305               | File System                 |
| iOS      | SQLCipher                       | Keychain (Secure Enclave)   |
| Android  | SQLCipher                       | EncryptedSharedPreferences  |

### Memory Safety

Encryption keys are securely zeroed from memory after use, preventing extraction from memory dumps or swap files.
