# sql-nolock-cli

CLI simples para inserir `WITH (NOLOCK)` após cada referência de tabela em comandos `SELECT` encontrados dentro de arquivos.

- Apenas comandos `SELECT` que iniciam um statement (após `;` ou início do arquivo) são considerados.
- Para cada `FROM`/`JOIN`, o CLI adiciona `WITH (NOLOCK)` após o objeto de tabela, antes do alias.
- Se já existir `WITH (...)` no objeto e não houver `NOLOCK`, o CLI inclui `, NOLOCK` dentro do mesmo hint.

## Instalação local

Dentro do diretório do projeto:

```bash
npm install
npm link
```

Isso disponibiliza o comando `nolock-sql` no seu PATH.

## Uso

```bash
nolock-sql --dir ./scripts          # varre recursivamente arquivos .sql
nolock-sql -d /caminho -e .sql,.txt # define extensões
nolock-sql --dry-run                # apenas simula alterações
nolock-sql --backup                 # cria .bak antes de gravar
```

## Observações

- O parser evita alterar conteúdo dentro de strings e comentários.
- Tabelas derivadas `FROM ( ... )` e funções com `FROM dbo.func(...)` não recebem `NOLOCK`.
- Casos complexos de T-SQL podem exigir um parser SQL dedicado; este CLI usa heurísticas conservadoras.