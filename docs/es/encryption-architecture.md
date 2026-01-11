# Arquitectura de Cifrado de Base de Datos

## Web (Navegador)

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
flowchart TB
    subgraph UserAuth["Autenticación de Usuario"]
        PWD["Contraseña de Usuario"]
        SALT["Salt Aleatorio (32 bytes)"]
    end

    subgraph KeyDerivation["Derivación de Clave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iteraciones"]
        KEY["Clave AES de 256 bits"]
    end

    subgraph Verification["Verificación de Contraseña"]
        KCV["Valor de Verificación de Clave<br/>(cifrado AES-GCM)"]
        STORE["IndexedDB<br/>(Almacenamiento del Navegador)"]
    end

    subgraph Encryption["Cifrado de Base de Datos"]
        CIPHER["SQLite3MultipleCiphers<br/>(WASM)"]
    end

    subgraph Database["Base de Datos Cifrada"]
        DB[("Base de Datos SQLite<br/>Completamente Cifrada en Reposo")]
    end

    subgraph Security["Seguridad de Memoria"]
        ZERO["Borrado Seguro de Buffer"]
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

## Electron (Escritorio)

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
flowchart TB
    subgraph UserAuth["Autenticación de Usuario"]
        PWD["Contraseña de Usuario"]
        SALT["Salt Aleatorio (32 bytes)"]
    end

    subgraph KeyDerivation["Derivación de Clave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iteraciones"]
        KEY["Clave AES de 256 bits"]
    end

    subgraph Verification["Verificación de Contraseña"]
        KCV["Valor de Verificación de Clave<br/>(cifrado AES-GCM)"]
        STORE["Sistema de Archivos<br/>(Datos de Aplicación)"]
    end

    subgraph Encryption["Cifrado de Base de Datos"]
        CIPHER["ChaCha20<br/>(better-sqlite3-multiple-ciphers)"]
    end

    subgraph Database["Base de Datos Cifrada"]
        DB[("Base de Datos SQLite<br/>Completamente Cifrada en Reposo")]
    end

    subgraph Security["Seguridad de Memoria"]
        ZERO["Borrado Seguro de Buffer"]
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
    subgraph UserAuth["Autenticación de Usuario"]
        PWD["Contraseña de Usuario"]
        SALT["Salt Aleatorio (32 bytes)"]
    end

    subgraph KeyDerivation["Derivación de Clave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iteraciones"]
        KEY["Clave AES de 256 bits"]
    end

    subgraph Verification["Verificación de Contraseña"]
        KCV["Valor de Verificación de Clave<br/>(cifrado AES-GCM)"]
        STORE["IndexedDB<br/>(Almacenamiento WebView)"]
    end

    subgraph Encryption["Cifrado de Base de Datos"]
        CIPHER["SQLCipher<br/>(iOS Nativo)"]
    end

    subgraph Database["Base de Datos Cifrada"]
        DB[("Base de Datos SQLite<br/>Completamente Cifrada en Reposo")]
    end

    subgraph Security["Seguridad de Memoria"]
        ZERO["Borrado Seguro de Buffer"]
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
    subgraph UserAuth["Autenticación de Usuario"]
        PWD["Contraseña de Usuario"]
        SALT["Salt Aleatorio (32 bytes)"]
    end

    subgraph KeyDerivation["Derivación de Clave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iteraciones"]
        KEY["Clave AES de 256 bits"]
    end

    subgraph Verification["Verificación de Contraseña"]
        KCV["Valor de Verificación de Clave<br/>(cifrado AES-GCM)"]
        STORE["IndexedDB<br/>(Almacenamiento WebView)"]
    end

    subgraph Encryption["Cifrado de Base de Datos"]
        CIPHER["SQLCipher<br/>(Android Nativo)"]
    end

    subgraph Database["Base de Datos Cifrada"]
        DB[("Base de Datos SQLite<br/>Completamente Cifrada en Reposo")]
    end

    subgraph Security["Seguridad de Memoria"]
        ZERO["Borrado Seguro de Buffer"]
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

## Referencia de Plataformas

| Plataforma | Biblioteca de Cifrado | Almacenamiento Salt/KCV |
| ---------- | --------------------- | ----------------------- |
| Web | SQLite3MultipleCiphers (WASM) | IndexedDB |
| Electron | ChaCha20 (better-sqlite3-multiple-ciphers) | Sistema de Archivos |
| iOS | SQLCipher | IndexedDB (WebView) |
| Android | SQLCipher | IndexedDB (WebView) |
