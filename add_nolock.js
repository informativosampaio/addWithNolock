'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// --- Configuration ---
const ROOT_DIR = process.env.TARGET_PATH || process.env.SCAN_ROOT || 'C:\\Sites\\sistema-contel\\conteltelecom\\CRON';
const INCLUDE_EXTENSIONS = new Set(['.aspx', '.aspx.vb']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', '.vscode', '.idea']);
const DEFAULT_VERBOSE = true;

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function skipWhitespaceAndComments(text, idx) {
  let i = idx;
  while (i < text.length) {
    while (i < text.length && isWhitespace(text[i])) i++;
    if (i >= text.length) break;
    // -- line comment
    if (text[i] === '-' && text[i + 1] === '-') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    // /* block comment */
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      if (i < text.length) i += 2;
      continue;
    }
    break;
  }
  return i;
}

function parseDelimitedIdentifier(text, idx) {
  if (idx >= text.length) return { end: idx, ok: false };
  const start = idx;
  const ch = text[idx];

  if (ch === '[') {
    let i = idx + 1;
    while (i < text.length) {
      if (text[i] === ']' && text[i + 1] === ']') { i += 2; continue; }
      if (text[i] === ']') { i++; break; }
      i++;
    }
    return { end: i, ok: true };
  }
  if (ch === '"') {
    let i = idx + 1;
    while (i < text.length) {
      if (text[i] === '"' && text[i + 1] === '"') { i += 2; continue; }
      if (text[i] === '"') { i++; break; }
      i++;
    }
    return { end: i, ok: true };
  }
  if (ch === '`') {
    let i = idx + 1;
    while (i < text.length) {
      if (text[i] === '`' && text[i + 1] === '`') { i += 2; continue; }
      if (text[i] === '`') { i++; break; }
      i++;
    }
    return { end: i, ok: true };
  }
  if (/[A-Za-z0-9_#$@\-]/.test(ch)) {
    let i = idx + 1;
    while (i < text.length && /[A-Za-z0-9_#$@\-]/.test(text[i])) i++;
    return { end: i, ok: true };
  }
  return { end: start, ok: false };
}

// a[.b[.c[.d]]]
function parseTableSpec(text, idx) {
  let i = idx;
  let partCount = 0;
  while (partCount < 4) {
    i = skipWhitespaceAndComments(text, i);
    const part = parseDelimitedIdentifier(text, i);
    if (!part.ok) break;
    i = part.end;
    partCount++;
    const saveI = i;
    i = skipWhitespaceAndComments(text, i);
    if (text[i] === '.') { i++; continue; }
    i = saveI;
    break;
  }
  return { end: i, ok: partCount > 0 };
}

function removeSqlComments(segment) {
  let out = '';
  for (let i = 0; i < segment.length; ) {
    const ch = segment[i], ch2 = segment[i + 1];
    if (ch === '-' && ch2 === '-') {
      while (i < segment.length && segment[i] !== '\n' && segment[i] !== '\r') i++;
      continue;
    }
    if (ch === '/' && ch2 === '*') {
      i += 2;
      while (i < segment.length && !(segment[i] === '*' && segment[i + 1] === '/')) i++;
      if (i < segment.length) i += 2;
      continue;
    }
    out += ch; i++;
  }
  return out;
}

function isFromWithinSelect(text, kwStartIndex) {
  const searchWindowStart = Math.max(0, kwStartIndex - 8000);
  let i = kwStartIndex - 1, depth = 0;
  for (; i >= searchWindowStart; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') { if (depth === 0) break; depth--; }
    else if (ch === ';' && depth === 0) break;
  }
  const segmentStart = Math.max(0, i + 1);
  let segment = text.slice(segmentStart, kwStartIndex);
  segment = removeSqlComments(segment);
  let lastKeyword = null, m;
  const re = /\b(select|delete|update|insert|merge)\b/ig;
  while ((m = re.exec(segment)) !== null) lastKeyword = m[1].toLowerCase();
  return lastKeyword === 'select';
}

// checa palavra na posição i com boundary depois
function isWordAt(text, i, word) {
  const w = word.toLowerCase();
  const slice = text.slice(i, i + w.length).toLowerCase();
  if (slice !== w) return false;
  const next = text[i + w.length];
  return (i + w.length >= text.length) || isWhitespace(next) || /[(),.;]/.test(next);
}

// Lê alias (com ou sem AS).
function parseAlias(text, idxAfterTable) {
  let i = skipWhitespaceAndComments(text, idxAfterTable);
  let sawAS = false;
  let asPos = null;

  if (isWordAt(text, i, 'AS')) {
    sawAS = true;
    asPos = i;
    i = skipWhitespaceAndComments(text, i + 2);
  }

  // se vier hint WITH logo depois da tabela, não há alias
  if (/^with\b/i.test(text.slice(i, i + 5))) {
    return { ok: false, sawAS, asPos, aliasStart: null, aliasEnd: null };
  }

  const ident = parseDelimitedIdentifier(text, i);
  if (!ident.ok) return { ok: false, sawAS, asPos, aliasStart: null, aliasEnd: null };

  // evitar confusão com keywords
  const tokenLower = text.slice(i, ident.end).trim().toLowerCase();
  const reserved = new Set(['join','inner','left','right','full','cross','on','where','group','order','having','union','intersect','except','option','for']);
  if (reserved.has(tokenLower)) return { ok: false, sawAS, asPos, aliasStart: null, aliasEnd: null };

  return { ok: true, aliasStart: i, aliasEnd: ident.end, sawAS, asPos };
}

// encontra o primeiro delimitador que encerra a referência atual
function findNextBoundary(text, idx) {
  let i = idx;
  while (i < text.length) {
    i = skipWhitespaceAndComments(text, i);
    if (i >= text.length) break;
    const ch = text[i];
    if (ch === ',' || ch === ')') break;
    if (isWordAt(text, i, 'on') || isWordAt(text, i, 'where') || isWordAt(text, i, 'group') ||
        isWordAt(text, i, 'order') || isWordAt(text, i, 'join') || isWordAt(text, i, 'inner') ||
        isWordAt(text, i, 'left') || isWordAt(text, i, 'right') || isWordAt(text, i, 'full') ||
        isWordAt(text, i, 'cross') || isWordAt(text, i, 'union') || isWordAt(text, i, 'intersect') ||
        isWordAt(text, i, 'except') || isWordAt(text, i, 'having') || isWordAt(text, i, 'option') ||
        isWordAt(text, i, 'for')) {
      break;
    }
    // consumir um token
    const ident = parseDelimitedIdentifier(text, i);
    if (ident.ok) { i = ident.end; continue; }
    i++;
  }
  return i;
}

function scanForWithBetween(text, startIdx, endIdx) {
  let i = startIdx;
  while (i < endIdx) {
    i = skipWhitespaceAndComments(text, i);
    if (i >= endIdx) break;
    if (isWordAt(text, i, 'with')) {
      let j = skipWhitespaceAndComments(text, i + 4);
      if (text[j] === '(') {
        let k = j + 1;
        let depth = 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '(') depth++;
          else if (text[k] === ')') depth--;
          k++;
        }
        return { found: true, withStart: i, withOpen: j, withClose: k - 1 };
      }
    }
    // avanço seguro
    const ident = parseDelimitedIdentifier(text, i);
    if (ident.ok) { i = ident.end; continue; }
    i++;
  }
  return { found: false };
}

function addNoLockInsideWithBlock(text, withOpen, withClose) {
  const inner = text.slice(withOpen + 1, withClose);
  if (/\bnolock\b/i.test(inner)) return text;
  const trimmed = inner.trim();
  let replacement;
  if (trimmed.length === 0) replacement = 'NOLOCK';
  else if (/[,)]\s*$/.test(inner)) replacement = inner.replace(/\s*$/,'') + ' NOLOCK';
  else replacement = inner.replace(/\s*$/,'') + ', NOLOCK';
  return text.slice(0, withOpen + 1) + replacement + text.slice(withClose);
}

function transformSqlInText(inputText) {
  let text = inputText;
  let hintsAdded = 0;
  let hintsMerged = 0;

  // Passo 1: (mantido) mesclar NOLOCK em qualquer WITH(...) que já exista próximo a SELECT
  {
    const regex = /with\s*\(/ig;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const idx = match.index;
      if (!isFromWithinSelect(text, idx)) continue;

      let j = idx + match[0].length - 1; // '('
      if (text[j] !== '(') continue;
      let k = j + 1;
      let depth = 1;
      while (k < text.length && depth > 0) {
        if (text[k] === '(') depth++;
        else if (text[k] === ')') depth--;
        k++;
      }
      const before = text;
      text = addNoLockInsideWithBlock(text, j, k - 1);
      if (text !== before) hintsMerged++;
      regex.lastIndex = k;
    }
  }

  // Passo 2: inserir/mover WITH (NOLOCK) SEMPRE **DEPOIS DO ALIAS** em FROM/JOIN/CROSS JOIN (apenas em SELECT)
  const fromJoinRegex = /\b(from|inner\s+join|left\s+(?:outer\s+)?join|right\s+(?:outer\s+)?join|full\s+(?:outer\s+)?join|cross\s+join|join)\b/ig;
  let m;
  while ((m = fromJoinRegex.exec(text)) !== null) {
    const kwStart = m.index;
    const kwEnd = kwStart + m[0].length;

    if (!isFromWithinSelect(text, kwStart)) continue;

    let i = skipWhitespaceAndComments(text, kwEnd);
    if (text[i] === '(') continue; // derived table

    const table = parseTableSpec(text, i);
    if (!table.ok) continue;
    const tableEnd = table.end;

    // limites da referência
    const boundaryEnd = findNextBoundary(text, tableEnd);

    // detectar alias
    const aliasInfo = parseAlias(text, tableEnd);
    const hasAlias = aliasInfo.ok;
    const aliasStart = aliasInfo.aliasStart;
    const aliasEnd = aliasInfo.aliasEnd;

    // procurar WITH(...) entre fim do nome da tabela e o boundary
    const withScan = scanForWithBetween(text, tableEnd, boundaryEnd);

    // caso 1: existe WITH e está depois do alias → só garantir NOLOCK
    if (withScan.found && hasAlias && withScan.withStart >= aliasEnd) {
      const before = text;
      text = addNoLockInsideWithBlock(text, withScan.withOpen, withScan.withClose);
      if (text !== before) hintsMerged++;
      fromJoinRegex.lastIndex = withScan.withClose + 1;
      continue;
    }

    // caso 2: existe WITH mas está antes do alias → mover para DEPOIS do alias e garantir NOLOCK
    if (withScan.found && hasAlias && withScan.withStart < aliasEnd) {
      // conteúdo do WITH ( ... )
      let withOpen = withScan.withOpen;
      let withClose = withScan.withClose;
      // primeiro, garantir NOLOCK dentro
      text = addNoLockInsideWithBlock(text, withOpen, withClose);
      // recalcular posições se o texto mudou
      const movedLen = text.length;
      // encontramos novamente o bloco para ter limites atualizados antes de remover
      const reFind = scanForWithBetween(text, tableEnd, boundaryEnd + (text.length - movedLen));
      if (reFind.found) {
        withOpen = reFind.withOpen; // posição do '('
        withClose = reFind.withClose;

        // remover bloco " WITH ( ... )" completo
        // withStart é 4 chars antes do withOpen, começando em 'w' de WITH
        const withStart = reFind.withStart;
        const withEnd = withClose + 1;

        // remover espaços adjacentes à esquerda
        let left = withStart;
        while (left > 0 && isWhitespace(text[left - 1])) left--;

        // efetua remoção
        const removed = text.slice(0, left) + text.slice(withEnd);
        // calcular novo aliasEnd após remoção (se a remoção foi antes do alias)
        const delta = removed.length - text.length;
        let newAliasEnd = aliasEnd + delta;

        // inserir bloco DEPOIS do alias
        const insertPos = newAliasEnd;
        const withBlock = ' WITH' + text.slice(withOpen, withClose + 1); // " WITH ( ... )"
        text = removed.slice(0, insertPos) + withBlock + removed.slice(insertPos);
        hintsMerged++; // tratamos como merge/movimentação
        fromJoinRegex.lastIndex = insertPos + withBlock.length;
        continue;
    }

    // caso 3: existe WITH mas não há alias → manter onde está e apenas garantir NOLOCK
    if (withScan.found && !hasAlias) {
      const before = text;
      text = addNoLockInsideWithBlock(text, withScan.withOpen, withScan.withClose);
      if (text !== before) hintsMerged++;
      fromJoinRegex.lastIndex = withScan.withClose + 1;
      continue;
    }

    // caso 4: não existe WITH
    if (!withScan.found) {
      if (hasAlias) {
        // inserir DEPOIS DO ALIAS
        const insertion = ' WITH (NOLOCK)';
        const insertPos = aliasEnd;
        text = text.slice(0, insertPos) + insertion + text.slice(insertPos);
        hintsAdded++;
        fromJoinRegex.lastIndex = insertPos + insertion.length;
      } else {
        // sem alias: inserir após o nome da tabela (com espaço final para não grudar)
        const insertion = ' WITH (NOLOCK) ';
        const insertPos = tableEnd;
        text = text.slice(0, insertPos) + insertion + text.slice(insertPos);
        hintsAdded++;
        fromJoinRegex.lastIndex = insertPos + insertion.length;
      }
    }
  }

  return { text, stats: { hintsAdded, hintsMerged } };
}

async function readFilePreserveBOM(filePath) {
  const buf = await fsp.readFile(filePath);
  const hasBOM = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const content = hasBOM ? buf.slice(3).toString('utf8') : buf.toString('utf8');
  return { content, hasBOM };
}

async function writeFilePreserveBOM(filePath, content, hasBOM) {
  const data = (hasBOM ? '\uFEFF' : '') + content;
  await fsp.writeFile(filePath, data, 'utf8');
}

async function processSingleFile(filePath, verbose = DEFAULT_VERBOSE) {
  const { content, hasBOM } = await readFilePreserveBOM(filePath);
  const { text: newContent, stats } = transformSqlInText(content);
  const changed = newContent !== content;
  if (changed) {
    await writeFilePreserveBOM(filePath, newContent, hasBOM);
    if (verbose) {
      console.log(`Updated: ${filePath} (added: ${stats.hintsAdded}, merged: ${stats.hintsMerged})`);
    }
  }
  return { changed, stats };
}

async function processFilesInDirectory(rootDir, options = {}) {
  const {
    verbose = DEFAULT_VERBOSE,
    includeExtensions = INCLUDE_EXTENSIONS,
    ignoreDirs = IGNORE_DIRS
  } = options;

  let filesScanned = 0;
  let filesChanged = 0;
  let totalAdded = 0;
  let totalMerged = 0;

  async function walk(currentDir) {
    const dir = await fsp.opendir(currentDir);
    for await (const dirent of dir) {
      const entryPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        if (ignoreDirs.has(dirent.name)) continue;
        await walk(entryPath);
      } else if (dirent.isFile()) {
        const lower = dirent.name.toLowerCase();
        const ext = lower.endsWith('.aspx.vb') ? '.aspx.vb' : path.extname(lower);
        if (includeExtensions.has(ext)) {
          filesScanned++;
          const { changed, stats } = await processSingleFile(entryPath, verbose);
          if (changed) filesChanged++;
          totalAdded += stats.hintsAdded;
          totalMerged += stats.hintsMerged;
        }
      }
    }
  }

  await walk(rootDir);
  return { filesScanned, filesChanged, totalAdded, totalMerged };
}

async function main() {
  const start = Date.now();
  console.log(`Node ${process.version} - Scanning for SELECT (NOLOCK after alias)`);
  console.log(`Root: ${ROOT_DIR}`);
  const res = await processFilesInDirectory(ROOT_DIR, { verbose: true });
  const ms = Date.now() - start;
  console.log(`Done in ${ms} ms. Files scanned: ${res.filesScanned}. Files changed: ${res.filesChanged}. Added: ${res.totalAdded}. Merged: ${res.totalMerged}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  ROOT_DIR,
  transformSqlInText,
  processFilesInDirectory,
  processSingleFile
};
}