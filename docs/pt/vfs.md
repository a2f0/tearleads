# VFS (Sistema de Arquivos Virtual)

Status: design em andamento (rastreado no issue do GitHub #1220).

Este documento captura a direção de design atual do VFS para o Tearleads. O objetivo é suportar compartilhamento criptografado e multiusuário de objetos de domínio (contatos, fotos, notas, arquivos) com hierarquia flexível e gerenciamento robusto de chaves.

## Objetivos

- Organizar objetos de domínio em uma hierarquia (pastas e estruturas aninhadas)
- Compartilhar objetos ou subárvores entre usuários
- Permitir que o mesmo objeto apareça em vários lugares
- Manter o conteúdo criptografado de ponta a ponta com encapsulamento explícito de chaves

## Modelo de Dados Central

### `vfs_registry`

Tabela de identidade para todos os itens participantes do VFS.

- `id`: chave primária compartilhada para o objeto
- `object_type`: `folder`, `contact`, `photo`, `note`, etc.
- `owner_id`: id do usuário proprietário
- `encrypted_session_key`: chave de criptografia de conteúdo (criptografada em repouso)
- `public_hierarchical_key`: chave pública para compartilhamento de subárvore
- `encrypted_private_hierarchical_key`: chave hierárquica privada criptografada

### `vfs_folders`

Metadados específicos de pasta para itens de registro do tipo `folder`.

- `id`: chave estrangeira para `vfs_registry.id`
- `encrypted_name`: nome da pasta criptografado com a chave de sessão do item

### `vfs_links`

Relacionamentos pai-filho entre itens de registro.

- `parent_id`, `child_id`
- `wrapped_session_key`: chave de sessão do filho encapsulada com a chave hierárquica do pai
- `wrapped_hierarchical_key`: chave hierárquica do filho encapsulada (opcional)
- `visible_children`: filtragem opcional de filhos para visualizações de compartilhamento parcial

Isso suporta um layout tipo DAG onde um objeto pode ser vinculado a partir de vários pais.

### `user_keys`

Material de chave por usuário.

- chave pública de criptografia (para receber compartilhamentos)
- chave pública de assinatura
- chaves privadas criptografadas
- sal Argon2 para derivação baseada em senha

### `vfs_access`

Concessões diretas de item para usuário.

- chaves de item encapsuladas para o destinatário
- nível de permissão (`read`, `write`, `admin`)
- metadados de expiração opcionais

## Padrão de Registro

Tabelas de domínio compartilham chaves primárias com `vfs_registry`.

Exemplo:

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
  encrypted_data BYTEA NOT NULL
);
```

Isso mantém a integridade referencial forte e permite que as operações do VFS tratem objetos de domínio através de uma camada de identidade.

## Modelo de Compartilhamento e Travessia

### Abrindo uma raiz

1. Ler concessões diretas em `vfs_access`
2. Descriptografar chaves encapsuladas com a chave privada do usuário
3. Renderizar itens raiz

### Travessia de filhos

1. Consultar `vfs_links` por `parent_id`
2. Desencapsular chaves de filhos usando a chave hierárquica do pai
3. Repetir recursivamente

### Compartilhando uma subárvore

1. Encapsular chaves raiz para o usuário destinatário
2. Inserir concessão em `vfs_access`
3. O destinatário atravessa a subárvore através de chaves de link encapsuladas

### Posicionamento múltiplo

O mesmo objeto pode ser vinculado a partir de vários pais adicionando mais linhas de `vfs_links`. Cada link pode ter restrições de visibilidade independentes.

## Direção de Criptografia

Direção de design atual:

- criptografia de conteúdo: `AES-256-GCM`
- derivação de senha: `Argon2id` + `HKDF`
- compartilhamento/encapsulamento de chaves: híbrido `ML-KEM-768 + X25519`
- assinaturas: `ML-DSA` (ou `Ed25519` onde necessário)

A intenção do design é defesa em profundidade mais um caminho para resistência pós-quântica.

## Exemplo de Hierarquia

```text
Pasta "Pessoas"
  - Contato "João Silva"
    - Foto (avatar)
    - Nota "Conheci na conferência"

Pasta "Contatos de Trabalho"
  - Contato "João Silva" (mesmo objeto, link diferente)
```

Links diferentes para o mesmo filho podem expor subconjuntos diferentes de descendentes.

## Notas sobre OPFS

Payloads binários (fotos/arquivos) devem residir no OPFS com criptografia em nível de item. O registro VFS armazena metadados e chaves encapsuladas; os bytes binários permanecem em armazenamento gerenciado pelo cliente.

## Fases de Implementação

1. Tabelas centrais e primitivas de ciclo de vida de chaves
2. Infraestrutura criptográfica (geração de chaves, encapsulamento, fluxos de desencapsulamento)
3. Operações VFS (vincular, compartilhar, descompartilhar, travessia)
4. Integrações de domínio (contatos/fotos/notas + campos criptografados)
5. Recursos avançados (`visible_children`, rotação de chaves, expiração, recuperação)

## Ressalvas Atuais

- Este é um documento de design em evolução, não uma especificação finalizada.
- Restrições de tipo pai/filho atualmente são esperadas na camada de aplicação.
- Fluxos de rotação de chaves e recuperação estão planejados, mas não finalizados.
