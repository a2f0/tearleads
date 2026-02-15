# VFS (Sistema de Arquivos Virtual)

Status: design em andamento (rastreado no issue do GitHub #1220).

Este documento captura a direcao de design atual do VFS para o Tearleads. O objetivo e suportar compartilhamento criptografado e multiusuario de objetos de dominio (contatos, fotos, notas, arquivos) com hierarquia flexivel e gerenciamento robusto de chaves.

## Objetivos

- Organizar objetos de dominio em uma hierarquia (pastas e estruturas aninhadas)
- Compartilhar objetos ou subarvores entre usuarios
- Permitir que o mesmo objeto apareca em varios lugares
- Manter o conteudo criptografado de ponta a ponta com encapsulamento explicito de chaves

## Modelo de Dados Central

### `vfs_registry`

Tabela de identidade para todos os itens participantes do VFS.

- `id`: chave primaria compartilhada para o objeto
- `object_type`: `folder`, `contact`, `photo`, `note`, etc.
- `owner_id`: id do usuario proprietario
- `encrypted_session_key`: chave de criptografia de conteudo (criptografada em repouso)
- `public_hierarchical_key`: chave publica para compartilhamento de subarvore
- `encrypted_private_hierarchical_key`: chave hierarquica privada criptografada

### `vfs_folders`

Metadados especificos de pasta para itens de registro do tipo `folder`.

- `id`: chave estrangeira para `vfs_registry.id`
- `encrypted_name`: nome da pasta criptografado com a chave de sessao do item

### `vfs_links`

Relacionamentos pai-filho entre itens de registro.

- `parent_id`, `child_id`
- `wrapped_session_key`: chave de sessao do filho encapsulada com a chave hierarquica do pai
- `wrapped_hierarchical_key`: chave hierarquica do filho encapsulada (opcional)
- `visible_children`: filtragem opcional de filhos para visualizacoes de compartilhamento parcial

Isso suporta um layout tipo DAG onde um objeto pode ser vinculado a partir de varios pais.

### `user_keys`

Material de chave por usuario.

- chave publica de criptografia (para receber compartilhamentos)
- chave publica de assinatura
- chaves privadas criptografadas
- sal Argon2 para derivacao baseada em senha

### `vfs_access`

Concessoes diretas de item para usuario.

- chaves de item encapsuladas para o destinatario
- nivel de permissao (`read`, `write`, `admin`)
- metadados de expiracao opcionais

## Padrao de Registro

Tabelas de dominio compartilham chaves primarias com `vfs_registry`.

Exemplo:

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
  encrypted_data BYTEA NOT NULL
);
```

Isso mantem a integridade referencial forte e permite que as operacoes do VFS tratem objetos de dominio atraves de uma camada de identidade.

## Modelo de Compartilhamento e Travessia

### Abrindo uma raiz

1. Ler concessoes diretas em `vfs_access`
2. Descriptografar chaves encapsuladas com a chave privada do usuario
3. Renderizar itens raiz

### Travessia de filhos

1. Consultar `vfs_links` por `parent_id`
2. Desencapsular chaves de filhos usando a chave hierarquica do pai
3. Repetir recursivamente

### Compartilhando uma subarvore

1. Encapsular chaves raiz para o usuario destinatario
2. Inserir concessao em `vfs_access`
3. O destinatario atravessa a subarvore atraves de chaves de link encapsuladas

### Posicionamento multiplo

O mesmo objeto pode ser vinculado a partir de varios pais adicionando mais linhas de `vfs_links`. Cada link pode ter restricoes de visibilidade independentes.

## Direcao de Criptografia

Direcao de design atual:

- criptografia de conteudo: `AES-256-GCM`
- derivacao de senha: `Argon2id` + `HKDF`
- compartilhamento/encapsulamento de chaves: hibrido `ML-KEM-768 + X25519`
- assinaturas: `ML-DSA` (ou `Ed25519` onde necessario)

A intencao do design e defesa em profundidade mais um caminho para resistencia pos-quantica.

## Exemplo de Hierarquia

```text
Pasta "Pessoas"
  - Contato "Joao Silva"
    - Foto (avatar)
    - Nota "Conheci na conferencia"

Pasta "Contatos de Trabalho"
  - Contato "Joao Silva" (mesmo objeto, link diferente)
```

Links diferentes para o mesmo filho podem expor subconjuntos diferentes de descendentes.

## Notas sobre OPFS

Payloads binarios (fotos/arquivos) devem residir no OPFS com criptografia em nivel de item. O registro VFS armazena metadados e chaves encapsuladas; os bytes binarios permanecem em armazenamento gerenciado pelo cliente.

## Fases de Implementacao

1. Tabelas centrais e primitivas de ciclo de vida de chaves
2. Infraestrutura criptografica (geracao de chaves, encapsulamento, fluxos de desencapsulamento)
3. Operacoes VFS (vincular, compartilhar, descompartilhar, travessia)
4. Integracoes de dominio (contatos/fotos/notas + campos criptografados)
5. Recursos avancados (`visible_children`, rotacao de chaves, expiracao, recuperacao)

## Ressalvas Atuais

- Este e um documento de design em evolucao, nao uma especificacao finalizada.
- Restricoes de tipo pai/filho atualmente sao esperadas na camada de aplicacao.
- Fluxos de rotacao de chaves e recuperacao estao planejados, mas nao finalizados.
