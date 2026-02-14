# Arquitetura de Criptografia do Banco de Dados

_Atualizado para refletir a versão em inglês de 11 de fevereiro de 2026._

## Web (Navegador)

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
flowchart TB
    subgraph UserAuth["Autenticação do Usuário"]
        PWD["Senha do Usuário"]
        SALT["Salt Aleatório (32 bytes)"]
    end

    subgraph KeyDerivation["Derivação de Chave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterações"]
        KEY["Chave AES de 256 bits"]
    end

    subgraph Verification["Verificação de Senha"]
        KCV["Valor de Verificação da Chave<br/>(criptografado com AES-GCM)"]
        STORE["IndexedDB<br/>(Armazenamento do Navegador)"]
    end

    subgraph Encryption["Criptografia do Banco de Dados"]
        CIPHER["SQLite3MultipleCiphers<br/>(WASM)"]
    end

    subgraph Database["Banco de Dados Criptografado"]
        DB[("Banco de Dados SQLite<br/>Totalmente Criptografado em Repouso")]
    end

    subgraph Security["Segurança de Memória"]
        ZERO["Zeragem Segura de Buffer"]
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
    subgraph UserAuth["Autenticação do Usuário"]
        PWD["Senha do Usuário"]
        SALT["Salt Aleatório (32 bytes)"]
    end

    subgraph KeyDerivation["Derivação de Chave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterações"]
        KEY["Chave AES de 256 bits"]
    end

    subgraph Verification["Verificação de Senha"]
        KCV["Valor de Verificação da Chave<br/>(criptografado com AES-GCM)"]
        STORE["Sistema de Arquivos<br/>(Dados do App)"]
    end

    subgraph Encryption["Criptografia do Banco de Dados"]
        CIPHER["ChaCha20<br/>(better-sqlite3-multiple-ciphers)"]
    end

    subgraph Database["Banco de Dados Criptografado"]
        DB[("Banco de Dados SQLite<br/>Totalmente Criptografado em Repouso")]
    end

    subgraph Security["Segurança de Memória"]
        ZERO["Zeragem Segura de Buffer"]
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
    subgraph UserAuth["Autenticação do Usuário"]
        PWD["Senha do Usuário"]
        SALT["Salt Aleatório (32 bytes)"]
    end

    subgraph KeyDerivation["Derivação de Chave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterações"]
        KEY["Chave AES de 256 bits"]
    end

    subgraph Verification["Verificação de Senha"]
        KCV["Valor de Verificação da Chave<br/>(criptografado com AES-GCM)"]
        STORE["IndexedDB<br/>(Armazenamento da WebView)"]
    end

    subgraph Encryption["Criptografia do Banco de Dados"]
        CIPHER["SQLCipher<br/>(iOS Nativo)"]
    end

    subgraph Database["Banco de Dados Criptografado"]
        DB[("Banco de Dados SQLite<br/>Totalmente Criptografado em Repouso")]
    end

    subgraph Security["Segurança de Memória"]
        ZERO["Zeragem Segura de Buffer"]
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
    subgraph UserAuth["Autenticação do Usuário"]
        PWD["Senha do Usuário"]
        SALT["Salt Aleatório (32 bytes)"]
    end

    subgraph KeyDerivation["Derivação de Chave"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 iterações"]
        KEY["Chave AES de 256 bits"]
    end

    subgraph Verification["Verificação de Senha"]
        KCV["Valor de Verificação da Chave<br/>(criptografado com AES-GCM)"]
        STORE["IndexedDB<br/>(Armazenamento da WebView)"]
    end

    subgraph Encryption["Criptografia do Banco de Dados"]
        CIPHER["SQLCipher<br/>(Android Nativo)"]
    end

    subgraph Database["Banco de Dados Criptografado"]
        DB[("Banco de Dados SQLite<br/>Totalmente Criptografado em Repouso")]
    end

    subgraph Security["Segurança de Memória"]
        ZERO["Zeragem Segura de Buffer"]
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

## Referência de Plataforma

| Plataforma | Biblioteca de Criptografia | Armazenamento de Salt/KCV |
| --- | --- | --- |
| Web | SQLite3MultipleCiphers (WASM) | IndexedDB |
| Electron | ChaCha20 (better-sqlite3-multiple-ciphers) | Sistema de Arquivos |
| iOS | SQLCipher | IndexedDB (WebView) |
| Android | SQLCipher | IndexedDB (WebView) |
