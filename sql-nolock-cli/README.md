# sql-nolock-cli

CLI que insere `WITH (NOLOCK)` em tabelas de comandos `SELECT` encontrados dentro de literais de string em páginas VB (.aspc, .aspx.vb).

- Varre por padrão arquivos `.aspc` e `.aspx.vb` (configurável via `--ext`).
- Localiza literais de string VB (entre aspas `"..."`) e processa o conteúdo como SQL.
- Para cada `FROM`/`JOIN`, adiciona `WITH (NOLOCK)` após a tabela. Se já existir `WITH (...)` sem `NOLOCK`, adiciona `, NOLOCK` dentro.
- Não altera funções table-valued nem tabelas derivadas `FROM ( ... )`.

## Instalação local

```bash
npm install
npm link
```

## Uso

```bash
nolock-sql --dir ./src                       # varre .aspc e .aspx.vb
nolock-sql -d /projeto -e .aspc,.aspx.vb     # define extensões
nolock-sql --dry-run                         # apenas simula alterações
nolock-sql --backup                          # cria .bak antes de gravar
```

## Observações

- O parser de strings considera aspas duplas de VB e o escape por aspas duplas duplicadas (`""`).
- Strings construídas por concatenação (ex.: `"SELECT ..." & var & " ..."`) não são mescladas; cada literal é processado isoladamente.
- Recomenda-se rodar com `--dry-run` e versionamento (git) antes de aplicar em massa.