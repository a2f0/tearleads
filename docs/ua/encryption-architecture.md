# Архітектура Шифрування Бази Даних

## Web (Браузер)

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
flowchart TB
    subgraph UserAuth["Автентифікація Користувача"]
        PWD["Пароль Користувача"]
        SALT["Випадкова Сіль (32 байти)"]
    end

    subgraph KeyDerivation["Деривація Ключа"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 ітерацій"]
        KEY["256-бітний Ключ AES"]
    end

    subgraph Verification["Перевірка Пароля"]
        KCV["Значення Перевірки Ключа<br/>(зашифровано AES-GCM)"]
        STORE["IndexedDB<br/>(Сховище Браузера)"]
    end

    subgraph Encryption["Шифрування Бази Даних"]
        CIPHER["SQLite3MultipleCiphers<br/>(WASM)"]
    end

    subgraph Database["Зашифрована База Даних"]
        DB[("База Даних SQLite<br/>Повністю Зашифрована в Стані Спокою")]
    end

    subgraph Security["Безпека Пам'яті"]
        ZERO["Безпечне Обнулення Буфера"]
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

## Electron (Десктоп)

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%
flowchart TB
    subgraph UserAuth["Автентифікація Користувача"]
        PWD["Пароль Користувача"]
        SALT["Випадкова Сіль (32 байти)"]
    end

    subgraph KeyDerivation["Деривація Ключа"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 ітерацій"]
        KEY["256-бітний Ключ AES"]
    end

    subgraph Verification["Перевірка Пароля"]
        KCV["Значення Перевірки Ключа<br/>(зашифровано AES-GCM)"]
        STORE["Файлова Система<br/>(Дані Додатку)"]
    end

    subgraph Encryption["Шифрування Бази Даних"]
        CIPHER["ChaCha20<br/>(better-sqlite3-multiple-ciphers)"]
    end

    subgraph Database["Зашифрована База Даних"]
        DB[("База Даних SQLite<br/>Повністю Зашифрована в Стані Спокою")]
    end

    subgraph Security["Безпека Пам'яті"]
        ZERO["Безпечне Обнулення Буфера"]
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
    subgraph UserAuth["Автентифікація Користувача"]
        PWD["Пароль Користувача"]
        SALT["Випадкова Сіль (32 байти)"]
    end

    subgraph KeyDerivation["Деривація Ключа"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 ітерацій"]
        KEY["256-бітний Ключ AES"]
    end

    subgraph Verification["Перевірка Пароля"]
        KCV["Значення Перевірки Ключа<br/>(зашифровано AES-GCM)"]
        STORE["IndexedDB<br/>(Сховище WebView)"]
    end

    subgraph Encryption["Шифрування Бази Даних"]
        CIPHER["SQLCipher<br/>(Нативний iOS)"]
    end

    subgraph Database["Зашифрована База Даних"]
        DB[("База Даних SQLite<br/>Повністю Зашифрована в Стані Спокою")]
    end

    subgraph Security["Безпека Пам'яті"]
        ZERO["Безпечне Обнулення Буфера"]
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
    subgraph UserAuth["Автентифікація Користувача"]
        PWD["Пароль Користувача"]
        SALT["Випадкова Сіль (32 байти)"]
    end

    subgraph KeyDerivation["Деривація Ключа"]
        PBKDF2["PBKDF2-SHA256<br/>600,000 ітерацій"]
        KEY["256-бітний Ключ AES"]
    end

    subgraph Verification["Перевірка Пароля"]
        KCV["Значення Перевірки Ключа<br/>(зашифровано AES-GCM)"]
        STORE["IndexedDB<br/>(Сховище WebView)"]
    end

    subgraph Encryption["Шифрування Бази Даних"]
        CIPHER["SQLCipher<br/>(Нативний Android)"]
    end

    subgraph Database["Зашифрована База Даних"]
        DB[("База Даних SQLite<br/>Повністю Зашифрована в Стані Спокою")]
    end

    subgraph Security["Безпека Пам'яті"]
        ZERO["Безпечне Обнулення Буфера"]
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

## Довідник Платформ

| Платформа | Бібліотека Шифрування | Сховище Salt/KCV |
| --------- | --------------------- | ---------------- |
| Web | SQLite3MultipleCiphers (WASM) | IndexedDB |
| Electron | ChaCha20 (better-sqlite3-multiple-ciphers) | Файлова Система |
| iOS | SQLCipher | IndexedDB (WebView) |
| Android | SQLCipher | IndexedDB (WebView) |
