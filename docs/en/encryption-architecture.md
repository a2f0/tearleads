# Database Encryption Architecture

## Web (Browser)

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
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
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
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
        STORE["File System<br/>(App Data)"]
    end

    subgraph Encryption["Database Encryption"]
        CIPHER["ChaCha20<br/>(better-sqlite3-multiple-ciphers)"]
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
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
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
        STORE["IndexedDB<br/>(WebView Storage)"]
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
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
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
        STORE["IndexedDB<br/>(WebView Storage)"]
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

## Platform Reference

| Platform | Encryption Library                         | Salt/KCV Storage    |
| -------- | ------------------------------------------ | ------------------- |
| Web      | SQLite3MultipleCiphers (WASM)              | IndexedDB           |
| Electron | ChaCha20 (better-sqlite3-multiple-ciphers) | File System         |
| iOS      | SQLCipher                                  | IndexedDB (WebView) |
| Android  | SQLCipher                                  | IndexedDB (WebView) |
