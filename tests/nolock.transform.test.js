'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transformSqlInText } = require('../add_nolock.js');

function normalizeSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}

test('adds NOLOCK after FROM table name', () => {
  const input = 'SELECT * FROM dbo.Table t WHERE 1=1';
  const { text, stats } = transformSqlInText(input);
  // ... t WITH (NOLOCK)
  assert.match(text, /FROM\s+dbo\.Table\s+t\s+WITH\s*\(NOLOCK\)\s+/i);
  assert.equal(stats.hintsAdded, 1);
});

test('adds NOLOCK with bracketed names and AS alias', () => {
  const input = 'SELECT * FROM [dbo].[My Table] AS mt';
  const { text } = transformSqlInText(input);
  // ... AS mt WITH (NOLOCK)
  assert.match(text, /FROM\s+\[dbo\]\s*\.\s*\[My Table\]\s+AS\s+mt\s+WITH\s*\(NOLOCK\)/i);
});

test('does not change derived tables', () => {
  const input = 'SELECT * FROM (SELECT 1 AS x) d';
  const { text, stats } = transformSqlInText(input);
  assert.equal(text, input);
  assert.equal(stats.hintsAdded, 0);
});

test('merges NOLOCK into existing WITH hints', () => {
  const input = 'SELECT * FROM dbo.Table WITH (INDEX(1)) t';
  const { text, stats } = transformSqlInText(input);
  assert.match(text, /WITH\s*\(.*INDEX\(1\).*NOLOCK.*\)/i);
  assert.equal(stats.hintsMerged, 1);
});

test('leaves existing NOLOCK intact', () => {
  const input = 'SELECT * FROM dbo.Table WITH (NOLOCK) t';
  const { text, stats } = transformSqlInText(input);
  assert.equal(text, input);
  assert.equal(stats.hintsAdded + stats.hintsMerged, 0);
});

test('handles JOINs and adds NOLOCK for both tables', () => {
  const input = 'SELECT * FROM dbo.A a INNER JOIN dbo.B b ON a.id=b.id';
  const { text } = transformSqlInText(input);
  // ... A a WITH (NOLOCK) ... JOIN ... B b WITH (NOLOCK)
  assert.match(text, /FROM\s+dbo\.A\s+a\s+WITH\s*\(NOLOCK\)\s+INNER\s+JOIN\s+dbo\.B\s+b\s+WITH\s*\(NOLOCK\)/i);
});

test('does not modify DELETE FROM statements', () => {
  const input = 'DELETE FROM dbo.Table WHERE id=1';
  const { text } = transformSqlInText(input);
  assert.equal(text, input);
});

test('does not modify UPDATE ... FROM join statements', () => {
  const input = 'UPDATE t SET col=1 FROM dbo.Table t WHERE id=1';
  const { text } = transformSqlInText(input);
  assert.equal(text, input);
});

test('CROSS JOIN gets NOLOCK', () => {
  const input = 'SELECT * FROM dbo.A a CROSS JOIN dbo.B b';
  const { text } = transformSqlInText(input);
  // ... A a WITH (NOLOCK) ... CROSS JOIN ... B b WITH (NOLOCK)
  assert.match(text, /dbo\.A\s+a\s+WITH\s*\(NOLOCK\).*CROSS\s+JOIN\s+dbo\.B\s+b\s+WITH\s*\(NOLOCK\)/i);
});

test('handles quoted identifiers', () => {
  const input = 'SELECT * FROM "dbo"."Table-Name" t';
  const { text } = transformSqlInText(input);
  // ... "Table-Name" t WITH (NOLOCK)
  assert.match(text, /FROM\s+"dbo"\s*\.\s*"Table-Name"\s+t\s+WITH\s*\(NOLOCK\)/i);
});

test('adds NOLOCK when WITH is after alias', () => {
  const input = 'SELECT * FROM dbo.Table t WITH (HOLDLOCK)';
  const { text } = transformSqlInText(input);
  // bloco WITH já depois do alias; garantir NOLOCK dentro
  assert.match(text, /WITH\s*\(.*HOLDLOCK.*NOLOCK.*\)/i);
});

test('insere NOLOCK após alias de uma letra e apenas em SELECT', () => {
  const input = `
SELECT A.id_FI_ADESAO
FROM FI_ADESAO A
INNER JOIN OPERADORA_RECARGA R ON R.id_OPERADORA_RECARGA = A.id_OPERADORA_RECARGA
WHERE A.cancelada_FI_ADESAO = 0
  AND R.realizada_surf_OPERADORA_RECARGA = 0
  AND A.id_OPERADORA_CHIP IN (
      SELECT id_OPERADORA_CHIP
      FROM FI_ADESAO A1
      INNER JOIN OPERADORA_RECARGA R1 ON R1.id_OPERADORA_RECARGA = A1.id_OPERADORA_RECARGA
      WHERE A1.cancelada_FI_ADESAO = 0
        AND R1.realizada_surf_OPERADORA_RECARGA = 1
)
DELETE FROM FI_ADESAO WHERE id_FI_ADESAO IN (
  SELECT A.id_FI_ADESAO
  FROM FI_ADESAO A
  INNER JOIN OPERADORA_RECARGA R ON R.id_OPERADORA_RECARGA = A.id_OPERADORA_RECARGA
)
`.trim();
  const { text } = transformSqlInText(input);

  // principal: ... A WITH (NOLOCK) / ... R WITH (NOLOCK)
  assert.match(text, /FROM\s+FI_ADESAO\s+A\s+WITH\s*\(NOLOCK\)(\s|$)/i);
  assert.match(text, /JOIN\s+OPERADORA_RECARGA\s+R\s+WITH\s*\(NOLOCK\)(\s|$)/i);

  // subselect: ... A1 WITH (NOLOCK) / ... R1 WITH (NOLOCK)
  assert.match(text, /FROM\s+FI_ADESAO\s+A1\s+WITH\s*\(NOLOCK\)(\s|$)/i);
  assert.match(text, /JOIN\s+OPERADORA_RECARGA\s+R1\s+WITH\s*\(NOLOCK\)(\s|$)/i);
});

// 1) JOIN com alias letra+número (b1) → depois do alias
test('handles JOIN with letter+number alias (b1) and puts NOLOCK after alias', () => {
  const input = 'SELECT * FROM dbo.A a INNER JOIN dbo.B b1 ON a.id=b.id';
  const { text } = transformSqlInText(input);

  assert.match(text, /FROM\s+dbo\.A\s+a\s+WITH\s*\(NOLOCK\)/i);
  assert.match(text, /INNER\s+JOIN\s+dbo\.B\s+b1\s+WITH\s*\(NOLOCK\)/i);
});

// 2) JOIN com AS A → depois de "AS A"
test('handles JOIN with AS alias (AS A) and puts NOLOCK after alias', () => {
  const input = 'SELECT * FROM dbo.A a INNER JOIN TABELA AS A ON a.id=b.id';
  const { text } = transformSqlInText(input);

  assert.match(text, /FROM\s+dbo\.A\s+a\s+WITH\s*\(NOLOCK\)/i);
  assert.match(text, /INNER\s+JOIN\s+TABELA\s+AS\s+A\s+WITH\s*\(NOLOCK\)/i);
});

// 3) JOIN com alias A1 (sem AS) → depois do alias
test('handles JOIN with alias A1 (no AS) and puts NOLOCK after alias', () => {
  const input = 'SELECT * FROM dbo.A a INNER JOIN TABELA A1 ON a.id=b.id';
  const { text } = transformSqlInText(input);

  assert.match(text, /FROM\s+dbo\.A\s+a\s+WITH\s*\(NOLOCK\)/i);
  assert.match(text, /INNER\s+JOIN\s+TABELA\s+A1\s+WITH\s*\(NOLOCK\)/i);
});
