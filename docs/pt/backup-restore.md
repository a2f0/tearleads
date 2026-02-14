# Backup e Restauração

O Tearleads fornece um formato de backup universal (`.tbu`) que funciona em todas as plataformas. Os backups incluem esquema de banco de dados, dados e arquivos, todos protegidos com criptografia forte.

## Especificação do Formato de Arquivo TBU

O formato **Tearleads Backup Utility** (`.tbu`) é um formato de backup multiplataforma projetado para backups seguros e portáteis.

### Estrutura do Arquivo

```text
┌─────────────────────────────────────────┐
│              HEADER (36 bytes)          │
├─────────────────────────────────────────┤
│   Magic Bytes: "TEARLEADSBAK" (12 bytes)    │
│    Format Version (2 bytes, LE)         │
│    Flags (2 bytes, LE)                  │
│    Salt (16 bytes)                      │
│    Reserved (4 bytes)                   │
├─────────────────────────────────────────┤
│           ENCRYPTED CHUNKS              │
├─────────────────────────────────────────┤
│    Chunk 0: Manifest                    │
│    Chunk 1: Database                    │
│    Chunk 2..N: Blobs (files)            │
└─────────────────────────────────────────┘
```

### Formato do Header (36 bytes, texto plano)

| Offset | Size | Field | Description |
| ------ | ---- | ----- | ----------- |
| 0 | 12 | Magic | `TEARLEADSBAK` (0x54 0x45 0x41 0x52 0x4c 0x45 0x41 0x44 0x53 0x42 0x41 0x4b) |
| 12 | 2 | Version | Versão do formato (atualmente 1), little-endian |
| 14 | 2 | Flags | Reservado para uso futuro |
| 16 | 16 | Salt | Salt aleatório para derivação de chave PBKDF2 |
| 32 | 4 | Reserved | Reservado para expansão futura |

### Criptografia

Os backups usam criptografia forte para proteger seus dados:

1. **Derivação de chave**: PBKDF2-SHA256 com 600.000 iterações
2. **Criptografia**: AES-256-GCM (criptografia autenticada)
3. **Compressão**: Gzip antes da criptografia

Cada chunk criptografado tem um header de 20 bytes seguido de texto cifrado:

| Size | Field | Description |
| ---- | ----- | ----------- |
| 4 | Payload Length | Tamanho do texto cifrado a seguir, em bytes |
| 1 | Chunk Type | 0=Manifest, 1=Database, 2=Blob |
| 3 | Reserved | Reservado para uso futuro |
| 12 | IV | Vetor de inicialização para AES-GCM |
| N | Ciphertext | Dados criptografados e comprimidos, incluindo a tag de autenticação GCM de 16 bytes |

### Tipos de Chunk

#### Manifest Chunk (Tipo 0)

Contém metadados sobre o backup:

```json
{
  "createdAt": "2024-01-15T10:30:00Z",
  "platform": "web",
  "appVersion": "1.2.3",
  "formatVersion": 1,
  "blobCount": 42,
  "blobTotalSize": 1048576,
  "instanceName": "My Instance"
}
```

#### Database Chunk (Tipo 1)

Contém esquema e dados:

```json
{
  "tables": [
    { "name": "contacts", "sql": "CREATE TABLE contacts (...)" }
  ],
  "indexes": [
    { "name": "idx_contacts_email", "sql": "CREATE INDEX ..." }
  ],
  "data": {
    "contacts": [
      { "id": 1, "name": "John", "email": "john@example.com" }
    ]
  }
}
```

#### Blob Chunks (Tipo 2)

Contém dados de arquivo. Arquivos grandes (>10 MB) são divididos em vários chunks:

```json
{
  "path": "files/abc123.jpg",
  "mimeType": "image/jpeg",
  "size": 2048576,
  "partIndex": 0,
  "totalParts": 1
}
```

### Propriedades de Segurança

- **Protegido por senha**: o backup exige senha para criar e restaurar
- **Autenticado**: a autenticação GCM evita adulteração
- **Sem material de chave**: chaves de criptografia nunca são armazenadas no backup
- **Com salt**: cada backup usa um salt aleatório exclusivo

## Criando um Backup

### Pelo Aplicativo

1. Abra **Settings** e navegue para **Backups**
2. Na seção "Create Backup":
   - Digite uma **backup password** (isso protege o arquivo de backup)
   - Confirme a senha
   - Opcionalmente marque **Include files** para incluir fotos, documentos etc.
3. Clique em **Create Backup**
4. Aguarde a conclusão do backup (a barra de progresso mostra o status)
5. O backup é salvo:
   - **Navegadores modernos**: armazenado no armazenamento do navegador (OPFS) e listado em "Stored Backups"
   - **Outros navegadores**: baixado para a pasta Downloads

O arquivo de backup é nomeado como `tearleads-backup-YYYY-MM-DD-HHmmss.tbu`.

### Pela CLI

```bash
# Interativo (solicita senha)
tearleads backup /path/to/backup.tbu

# Não interativo
tearleads backup /path/to/backup.tbu --password "your-backup-password"
```

Observação: backups da CLI incluem dados do banco, mas não arquivos (blobs).

## Restaurando um Backup

### A partir de um Backup Armazenado

Se seu navegador suportar OPFS, os backups são armazenados localmente e listados na seção "Stored Backups":

1. Abra **Settings** e navegue para **Backups**
2. Encontre seu backup na tabela "Stored Backups"
3. Clique em **Restore** ao lado do backup
4. Digite a **backup password** (a senha usada ao criar o backup)
5. Clique em **Validate Backup** para verificar a senha
6. Depois de validar, você verá detalhes do backup (data de criação, plataforma, quantidade de arquivos)
7. Digite uma **new instance password** (esta será a senha da instância restaurada)
8. Confirme a nova senha
9. Clique em **Restore Backup**
10. Aguarde a restauração terminar
11. Troque para a nova instância no seletor de instâncias

### A partir de um Arquivo Externo

1. Abra **Settings** e navegue para **Backups**
2. Na seção "Restore from File", clique em **Select Backup File (.tbu)**
3. Escolha um arquivo `.tbu` no seu computador
4. Siga os mesmos passos de validação e restauração acima

### Restaurar pela CLI

```bash
# Interativo (solicita senha e confirmação)
tearleads restore /path/to/backup.tbu

# Não interativo
tearleads restore /path/to/backup.tbu --password "backup-password" --force
```

Aviso: restaurar pela CLI substitui o banco de dados atual. Use `--force` para pular a confirmação.

## Comparação entre Plataformas

| Feature | Web (WASM) | Electron | iOS/Android | CLI |
| ------- | ---------- | -------- | ----------- | --- |
| Create Backup | Yes | Yes | Yes | Yes |
| Restore Backup | Yes | Yes | Yes | Yes |
| Include Files | Yes | Yes | Yes | No |
| Backup Storage | OPFS/Download | File system | File system | File system |
| Cross-Platform Restore | Yes | Yes | Yes | Yes |

## Conteúdo do Backup

### Incluído

- Todas as tabelas e índices do banco de dados
- Todos os dados das tabelas (contatos, notas etc.)
- Arquivos (fotos, documentos, anexos), se "Include files" estiver marcado
- Esquema do banco de dados para recriação

### Excluído

- Tabelas internas do SQLite (`sqlite_sequence`, `sqlite_stat1` etc.)
- Histórico de migrações (`__drizzle_migrations`)
- Tabelas internas (tabelas que começam com `_`)
- Chaves de criptografia (derivadas da sua senha)

## Boas Práticas

1. **Use uma senha de backup forte** - Isso protege seu arquivo de backup caso alguém tenha acesso a ele
2. **Armazene backups com segurança** - Mantenha os arquivos de backup em um local seguro
3. **Teste restaurações periodicamente** - Verifique se seus backups funcionam restaurando em uma instância de teste
4. **Faça backup regularmente** - Crie backups antes de mudanças importantes ou periodicamente
5. **Lembre-se das suas senhas** - Você precisa da senha do backup para restaurar; não há opção de recuperação
6. **Inclua arquivos quando necessário** - Backups com arquivos são maiores, mas incluem todos os anexos

## Solução de Problemas

### Erro "Invalid password"

A senha informada não corresponde à senha usada para criar o backup. Tente novamente com a senha correta.

### Erro "Invalid backup file"

O arquivo pode estar corrompido ou não ser um arquivo `.tbu` válido. Verifique se:

- O arquivo tem a extensão `.tbu`
- O arquivo não foi modificado nem truncado
- O arquivo foi totalmente baixado/transferido

### Arquivos de backup grandes

Se seu backup for muito grande:

- Considere excluir arquivos para gerar um backup menor
- Verifique se há espaço de armazenamento suficiente
- Aguarde durante backup/restauração (o progresso é mostrado)

### A restauração cria uma nova instância

Isso é intencional. Restaurar pela interface do aplicativo cria uma nova instância chamada "Backup (Month Day, Year)" para evitar sobrescrever os dados atuais. Você pode alternar entre instâncias no seletor de instâncias. Em contraste, restaurar pela CLI sobrescreve o banco de dados atual.
