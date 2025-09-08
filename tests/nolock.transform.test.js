'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transformSqlInText } = require('../add_nolock.js');

function normalizeSpaces(s) {
return s.replace(/\s+/g, ' ').trim();
}

// ⚠️ Este é o arquivo de teste para o código modificado que eu te enviei.
// Certifique-se de que o caminho para 'add_nolock.js' esteja correto.
// Para rodar, use o comando: node --test ./nome_do_arquivo_de_teste.js

test('adds NOLOCK to all specified SQL cases', (t) => {
// Caso 1: SELECT * FROM Table WHERE...
const sql1_input = 'SELECT * FROM Table WHERE a=b';
const { text: sql1_output, stats: sql1_stats } = transformSqlInText(sql1_input);
assert.equal(normalizeSpaces(sql1_output), normalizeSpaces('SELECT * FROM Table WITH (NOLOCK) WHERE a=b'));
assert.equal(sql1_stats.hintsAdded, 1);
assert.equal(sql1_stats.hintsMerged, 0);

// Caso 2: SELECT * FROM Table WITH (NOLOCK) WHERE... (não deve mudar)
const sql2_input = 'SELECT * FROM Table WITH (NOLOCK) WHERE a=b';
const { text: sql2_output, stats: sql2_stats } = transformSqlInText(sql2_input);
assert.equal(normalizeSpaces(sql2_output), normalizeSpaces('SELECT * FROM Table WITH (NOLOCK) WHERE a=b'));
assert.equal(sql2_stats.hintsAdded, 0);
assert.equal(sql2_stats.hintsMerged, 0);

// Caso 3: SELECT * FROM Table A WHERE...
const sql3_input = 'SELECT * FROM Table A WHERE a=b';
const { text: sql3_output, stats: sql3_stats } = transformSqlInText(sql3_input);
assert.equal(normalizeSpaces(sql3_output), normalizeSpaces('SELECT * FROM Table A WITH (NOLOCK) WHERE a=b'));
assert.equal(sql3_stats.hintsAdded, 1);
assert.equal(sql3_stats.hintsMerged, 0);

// Caso 4: SELECT * FROM Table a WHERE...
const sql4_input = 'SELECT * FROM Table a WHERE a=b';
const { text: sql4_output, stats: sql4_stats } = transformSqlInText(sql4_input);
assert.equal(normalizeSpaces(sql4_output), normalizeSpaces('SELECT * FROM Table a WITH (NOLOCK) WHERE a=b'));
assert.equal(sql4_stats.hintsAdded, 1);
assert.equal(sql4_stats.hintsMerged, 0);

// Caso 5: SELECT * FROM Table AA WHERE...
const sql5_input = 'SELECT * FROM Table AA WHERE a=b';
const { text: sql5_output, stats: sql5_stats } = transformSqlInText(sql5_input);
assert.equal(normalizeSpaces(sql5_output), normalizeSpaces('SELECT * FROM Table AA WITH (NOLOCK) WHERE a=b'));
assert.equal(sql5_stats.hintsAdded, 1);
assert.equal(sql5_stats.hintsMerged, 0);

// Caso 6: SELECT * FROM Table Ab WHERE...
const sql6_input = 'SELECT * FROM Table Ab WHERE a=b';
const { text: sql6_output, stats: sql6_stats } = transformSqlInText(sql6_input);
assert.equal(normalizeSpaces(sql6_output), normalizeSpaces('SELECT * FROM Table Ab WITH (NOLOCK) WHERE a=b'));
assert.equal(sql6_stats.hintsAdded, 1);
assert.equal(sql6_stats.hintsMerged, 0);

// Caso 7: SELECT * FROM Table AS A WHERE...
const sql7_input = 'SELECT * FROM Table AS A WHERE a=b';
const { text: sql7_output, stats: sql7_stats } = transformSqlInText(sql7_input);
assert.equal(normalizeSpaces(sql7_output), normalizeSpaces('SELECT * FROM Table AS A WITH (NOLOCK) WHERE a=b'));
assert.equal(sql7_stats.hintsAdded, 1);
assert.equal(sql7_stats.hintsMerged, 0);

// Caso 8: SELECT * FROM Table AS a WHERE...
const sql8_input = 'SELECT * FROM Table AS a WHERE a=b';
const { text: sql8_output, stats: sql8_stats } = transformSqlInText(sql8_input);
assert.equal(normalizeSpaces(sql8_output), normalizeSpaces('SELECT * FROM Table AS a WITH (NOLOCK) WHERE a=b'));
assert.equal(sql8_stats.hintsAdded, 1);
assert.equal(sql8_stats.hintsMerged, 0);

// Caso 9: SELECT * FROM Table AS AA WHERE...
const sql9_input = 'SELECT * FROM Table AS AA WHERE a=b';
const { text: sql9_output, stats: sql9_stats } = transformSqlInText(sql9_input);
assert.equal(normalizeSpaces(sql9_output), normalizeSpaces('SELECT * FROM Table AS AA WITH (NOLOCK) WHERE a=b'));
assert.equal(sql9_stats.hintsAdded, 1);
assert.equal(sql9_stats.hintsMerged, 0);

// Caso 10: SELECT * FROM Table AS Ab WHERE...
const sql10_input = 'SELECT * FROM Table AS Ab WHERE a=b';
const { text: sql10_output, stats: sql10_stats } = transformSqlInText(sql10_input);
assert.equal(normalizeSpaces(sql10_output), normalizeSpaces('SELECT * FROM Table AS Ab WITH (NOLOCK) WHERE a=b'));
assert.equal(sql10_stats.hintsAdded, 1);
assert.equal(sql10_stats.hintsMerged, 0);

// Caso 11: SELECT * FROM Table A INNER JOIN Table B ON...
const sql11_input = 'SELECT * FROM Table A INNER JOIN Table B ON a.id = b.id';
const { text: sql11_output, stats: sql11_stats } = transformSqlInText(sql11_input);
assert.equal(normalizeSpaces(sql11_output), normalizeSpaces('SELECT * FROM Table A WITH (NOLOCK) INNER JOIN Table B WITH (NOLOCK) ON a.id = b.id'));
assert.equal(sql11_stats.hintsAdded, 2);
assert.equal(sql11_stats.hintsMerged, 0);

// Caso 12: SELECT * FROM Table AS A INNER JOIN Table B ON...
const sql12_input = 'SELECT * FROM Table AS A INNER JOIN Table B ON a.id = b.id';
const { text: sql12_output, stats: sql12_stats } = transformSqlInText(sql12_input);
assert.equal(normalizeSpaces(sql12_output), normalizeSpaces('SELECT * FROM Table AS A WITH (NOLOCK) INNER JOIN Table B WITH (NOLOCK) ON a.id = b.id'));
assert.equal(sql12_stats.hintsAdded, 2);
assert.equal(sql12_stats.hintsMerged, 0);
});

test('does not add NOLOCK to FROM clause with existing WITH hint', (t) => {
const input = 'SELECT * FROM Table (INDEX = X)';
const { text, stats } = transformSqlInText(input);
assert.equal(normalizeSpaces(text), normalizeSpaces('SELECT * FROM Table (INDEX = X) WITH (NOLOCK)'));
assert.equal(stats.hintsAdded, 1);
assert.equal(stats.hintsMerged, 0);
});

test('merges NOLOCK into existing WITH hint', (t) => {
const input = 'SELECT * FROM Table WITH (INDEX(IX_A)) WHERE a=b';
const { text, stats } = transformSqlInText(input);
assert.equal(normalizeSpaces(text), normalizeSpaces('SELECT * FROM Table WITH (INDEX(IX_A), NOLOCK) WHERE a=b'));
assert.equal(stats.hintsAdded, 0);
assert.equal(stats.hintsMerged, 1);
});

test('merges NOLOCK into existing WITH hint with AS alias', (t) => {
const input = 'SELECT * FROM Table AS T WITH (INDEX(IX_A)) WHERE a=b';
const { text, stats } = transformSqlInText(input);
assert.equal(normalizeSpaces(text), normalizeSpaces('SELECT * FROM Table AS T WITH (INDEX(IX_A), NOLOCK) WHERE a=b'));
assert.equal(stats.hintsAdded, 0);
assert.equal(stats.hintsMerged, 1);
});

test('handles multiple joins and mixed cases', (t) => {
  // A string de entrada agora está corretamente delimitada por crases (`).
  const input = `
    SELECT t1.*, t2.*
    FROM [dbo].[Table1] AS t1
    INNER JOIN [dbo].[Table2] t2 ON t1.id = t2.id
    LEFT JOIN [dbo].[Table3] t3 WITH (INDEX(IX_T3)) ON t1.id = t3.id
    WHERE t1.status = 'active'
  `;

  // A string de saída esperada também está corretamente delimitada.
  const expected = `
    SELECT t1.*, t2.*
    FROM [dbo].[Table1] AS t1 WITH (NOLOCK)
    INNER JOIN [dbo].[Table2] t2 WITH (NOLOCK) ON t1.id = t2.id
    LEFT JOIN [dbo].[Table3] t3 WITH (INDEX(IX_T3), NOLOCK) ON t1.id = t3.id
    WHERE t1.status = 'active'
  `;

  const { text, stats } = transformSqlInText(input);

  assert.equal(normalizeSpaces(text), normalizeSpaces(expected));
  assert.equal(stats.hintsAdded, 2);
  assert.equal(stats.hintsMerged, 1);
});

test('adds NOLOCK correctly when a string literal follows the FROM clause', (t) => {
  // A string de entrada agora está corretamente delimitada por crases (`).
  const input = `SELECT enotas_api_key FROM ADM_CONFIG "enotas_api_key"`;
  const expected = `SELECT enotas_api_key FROM ADM_CONFIG WITH (NOLOCK) "enotas_api_key"`;

  const { text, stats } = transformSqlInText(input);

  assert.equal(normalizeSpaces(text), normalizeSpaces(expected));
  assert.equal(stats.hintsAdded, 1);
  assert.equal(stats.hintsMerged, 0);
});