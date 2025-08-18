function buildMask(sql) {
	const length = sql.length;
	const maskChars = new Array(length);
	let inSingle = false;
	let inDouble = false;
	let inBracket = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < length; i += 1) {
		const ch = sql[i];
		const next = i + 1 < length ? sql[i + 1] : '';

		if (inLineComment) {
			maskChars[i] = ' ';
			if (ch === '\n') inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			maskChars[i] = ' ';
			if (ch === '*' && next === '/') {
				maskChars[i + 1] = ' ';
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (inSingle) {
			maskChars[i] = ' ';
			if (ch === "'") {
				if (next === "'") {
					maskChars[i + 1] = ' ';
					i += 1;
				} else {
					inSingle = false;
				}
			}
			continue;
		}
		if (inDouble) {
			maskChars[i] = ' ';
			if (ch === '"') {
				if (next === '"') {
					maskChars[i + 1] = ' ';
					i += 1;
				} else {
					inDouble = false;
				}
			}
			continue;
		}
		if (inBracket) {
			maskChars[i] = ' ';
			if (ch === ']') {
				if (next === ']') {
					maskChars[i + 1] = ' ';
					i += 1;
				} else {
					inBracket = false;
				}
			}
			continue;
		}

		// Enter states
		if (ch === '-' && next === '-') {
			maskChars[i] = ' ';
			maskChars[i + 1] = ' ';
			inLineComment = true;
			i += 1;
			continue;
		}
		if (ch === '/' && next === '*') {
			maskChars[i] = ' ';
			maskChars[i + 1] = ' ';
			inBlockComment = true;
			i += 1;
			continue;
		}
		if (ch === "'") {
			maskChars[i] = ' ';
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			maskChars[i] = ' ';
			inDouble = true;
			continue;
		}
		if (ch === '[') {
			maskChars[i] = ' ';
			inBracket = true;
			continue;
		}

		// Keep char
		maskChars[i] = ch;
	}

	return maskChars.join('');
}

function isWhitespaceChar(ch) {
	return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function skipSpaces(str, idx) {
	let i = idx;
	while (i < str.length && isWhitespaceChar(str[i])) i += 1;
	return i;
}

function readWord(str, idx) {
	let i = idx;
	while (i < str.length && /[A-Za-z_]/.test(str[i])) i += 1;
	return { word: str.slice(idx, i), end: i };
}

function caseEq(a, b) {
	return a.toLowerCase() === b.toLowerCase();
}

function parseSingleIdentifier(sql, startIdx) {
	let i = startIdx;
	if (i >= sql.length) return null;

	if (sql[i] === '[') {
		// bracketed identifier
		i += 1;
		while (i < sql.length) {
			if (sql[i] === ']') {
				if (sql[i + 1] === ']') { i += 2; continue; }
				i += 1; break;
			}
			i += 1;
		}
		return { begin: startIdx, end: i };
	}
	if (sql[i] === '"') {
		// quoted identifier
		i += 1;
		while (i < sql.length) {
			if (sql[i] === '"') {
				if (sql[i + 1] === '"') { i += 2; continue; }
				i += 1; break;
			}
			i += 1;
		}
		return { begin: startIdx, end: i };
	}

	let start = i;
	while (i < sql.length && /[A-Za-z0-9_#$]/.test(sql[i])) i += 1;
	if (i === start) return null;
	return { begin: startIdx, end: i };
}

function parseAlias(sql, mask, idx) {
	let i = skipSpaces(mask, idx);
	// optional AS
	if (/[A-Za-z_]/.test(mask[i] || '')) {
		const { word, end } = readWord(mask, i);
		if (word && caseEq(word, 'as')) i = skipSpaces(mask, end);
	}

	// Try bracketed/quoted identifier first
	if (sql[i] === '[' || sql[i] === '"') {
		const id = parseSingleIdentifier(sql, i);
		if (id) return { present: true, aliasBegin: id.begin, aliasEnd: id.end };
		return { present: false };
	}

	// Bare identifier: ensure it's not a control keyword like ON/WITH/JOIN/etc
	if (/[A-Za-z_]/.test(mask[i] || '')) {
		const { word, end } = readWord(mask, i);
		const lower = (word || '').toLowerCase();
		const blockers = new Set([
			'with','on','join','left','right','full','inner','cross','outer','apply',
			'where','group','order','union','except','intersect','pivot','unpivot','for','option'
		]);
		if (blockers.has(lower)) return { present: false };
		return { present: true, aliasBegin: i, aliasEnd: end };
	}

	return { present: false };
}

function parseObjectPath(sql, startIdx) {
	let i = startIdx;
	// skip spaces
	while (i < sql.length && isWhitespaceChar(sql[i])) i += 1;
	const begin = i;

	if (sql[i] === '@') return { begin, end: i, isVariable: true };

	let haveAny = false;
	while (i < sql.length) {
		if (sql[i] === '[') {
			// bracketed identifier
			i += 1;
			while (i < sql.length) {
				if (sql[i] === ']') {
					if (sql[i + 1] === ']') { i += 2; continue; }
					i += 1; break;
				}
				i += 1;
			}
			haveAny = true;
			if (sql[i] === '.') { i += 1; continue; }
			break;
		} else if (sql[i] === '"') {
			// quoted identifier
			i += 1;
			while (i < sql.length) {
				if (sql[i] === '"') {
					if (sql[i + 1] === '"') { i += 2; continue; }
					i += 1; break;
				}
				i += 1;
			}
			haveAny = true;
			if (sql[i] === '.') { i += 1; continue; }
			break;
		} else {
			// bare identifier
			let start = i;
			while (i < sql.length && /[A-Za-z0-9_#$]/.test(sql[i])) i += 1;
			if (i === start) break;
			haveAny = true;
			if (sql[i] === '.') { i += 1; continue; }
			break;
		}
	}

	const end = i;
	return { begin, end, isVariable: false, haveAny };
}

function findMatchingParen(sql, openIdx) {
	let depth = 0;
	for (let i = openIdx; i < sql.length; i += 1) {
		const ch = sql[i];
		if (ch === '(') depth += 1;
		else if (ch === ')') {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function collectModificationsForRange(sql, mask, start, end) {
	const mods = [];
	const subMask = mask.slice(start, end);
	const regex = /\b(from|join)\b/gi;
	let m;
	while ((m = regex.exec(subMask)) !== null) {
		const kw = m[1];
		const kwAbs = start + m.index;
		let i = kwAbs + kw.length;
		i = skipSpaces(mask, i);
		if (i >= sql.length) continue;
		if (mask[i] === '(') {
			// derived table, skip
			continue;
		}

		// parse object path from original SQL
		const { end: objEnd, isVariable, haveAny } = parseObjectPath(sql, i);
		if (!haveAny || isVariable) continue;

		// Check for function call right after object path
		let j = objEnd;
		j = skipSpaces(mask, j);
		if (j < sql.length && sql[j] === '(') {
			// table-valued function: skip
			continue;
		}

		// Parse optional alias and set insertion/check point AFTER alias if present
		let aliasEnd = objEnd;
		const aliasInfo = parseAlias(sql, mask, j);
		if (aliasInfo && aliasInfo.present) aliasEnd = aliasInfo.aliasEnd;

		// 1) If there is a WITH right after object (before alias), move it after alias
		let k = skipSpaces(mask, objEnd);
		if (mask.slice(k, k + 4).toLowerCase() === 'with') {
			let w = k + 4;
			w = skipSpaces(mask, w);
			if (sql[w] === '(') {
				const close = findMatchingParen(sql, w);
				if (close > w) {
					const withStart = k;
					const withEnd = close + 1; // exclusive
					const insideOriginal = sql.slice(w + 1, close);
					let insideNew = insideOriginal.trim();
					if (!/\bnolock\b/i.test(insideOriginal)) insideNew = insideNew.length > 0 ? insideNew + ', NOLOCK' : 'NOLOCK';
					const newWithText = ' WITH (' + insideNew + ')';

					// Determine alias position after this WITH, if any
					const afterWith = skipSpaces(mask, withEnd);
					const aliasAfterWith = parseAlias(sql, mask, afterWith);
					const insertIndex = (aliasAfterWith && aliasAfterWith.present) ? aliasAfterWith.aliasEnd : aliasEnd;

					// Remove the WITH before alias and insert after alias
					mods.push({ type: 'remove', start: withStart, end: withEnd });
					mods.push({ type: 'insert', index: insertIndex, text: newWithText });
					continue;
				}
			}
		}

		// 2) After alias (preferred placement)
		k = skipSpaces(mask, aliasEnd);
		let hasWith = false;
		if (mask.slice(k, k + 4).toLowerCase() === 'with') {
			hasWith = true;
			let w = k + 4;
			w = skipSpaces(mask, w);
			if (sql[w] === '(') {
				const close = findMatchingParen(sql, w);
				if (close > w) {
					const inside = sql.slice(w + 1, close).toLowerCase();
					if (!/\bnolock\b/i.test(inside)) {
						const trimmed = inside.trim();
						const insertText = trimmed.length > 0 ? ', NOLOCK' : 'NOLOCK';
						mods.push({ type: 'insert', index: close, text: insertText });
					}
					continue; // WITH already present; handled insert or nothing
				}
			}
		}

		if (!hasWith) {
			mods.push({ type: 'insert', index: aliasEnd, text: ' WITH (NOLOCK)' });
		}
	}
	return mods;
}

function processSqlContent(sql) {
	const mask = buildMask(sql);
	const mods = [];

	// Find SELECT statements that start at the beginning of a statement (after last ';')
	let lastSep = -1;
	for (let i = 0; i < mask.length; i += 1) {
		const ch = mask[i];
		if (ch === ';') { lastSep = i; continue; }
		if ((ch === 's' || ch === 'S') && mask.slice(i, i + 6).toLowerCase() === 'select') {
			let onlyWs = true;
			for (let k = lastSep + 1; k < i; k += 1) { if (!isWhitespaceChar(mask[k])) { onlyWs = false; break; } }
			if (!onlyWs) continue;
			let end = mask.indexOf(';', i + 6);
			if (end === -1) end = mask.length;
			const rangeMods = collectModificationsForRange(sql, mask, i, end);
			for (const mod of rangeMods) mods.push(mod);
			i = end; lastSep = end;
		}
	}

	if (mods.length === 0) return { result: sql, statementsChanged: 0, tablesChanged: 0 };

	// Apply modifications from end to start (support insert and remove)
	mods.sort((a, b) => {
		const pa = a.type === 'insert' ? a.index : a.start;
		const pb = b.type === 'insert' ? b.index : b.start;
		return pb - pa;
	});
	let result = sql;
	let tablesChanged = 0;
	let statementsChanged = 0;

	for (const mod of mods) {
		if (mod.type === 'insert') {
			result = result.slice(0, mod.index) + mod.text + result.slice(mod.index);
			tablesChanged += 1;
		} else if (mod.type === 'remove') {
			result = result.slice(0, mod.start) + result.slice(mod.end);
			tablesChanged += 1;
		}
	}

	// Rough estimate of statements changed (count SELECTs in original mask)
	let lastSep2 = -1;
	const touchedStatementStarts = new Set();
	for (let i = 0; i < mask.length; i += 1) {
		if (mask[i] === ';') lastSep2 = i;
		if ((mask[i] === 's' || mask[i] === 'S') && mask.slice(i, i + 6).toLowerCase() === 'select') {
			let onlyWs = true;
			for (let k = lastSep2 + 1; k < i; k += 1) { if (!isWhitespaceChar(mask[k])) { onlyWs = false; break; } }
			if (!onlyWs) continue;
			touchedStatementStarts.add(i);
		}
	}
	statementsChanged = touchedStatementStarts.size > 0 && tablesChanged > 0 ? touchedStatementStarts.size : 0;

	return { result, statementsChanged, tablesChanged };
}

function processTextWithEmbeddedSql(text) {
	let i = 0;
	let resultParts = [];
	let lastIndex = 0;
	let totalTables = 0;
	let totalStatements = 0;

	const length = text.length;
	while (i < length) {
		const ch = text[i];
		if (ch === '"') {
			if (i > lastIndex) resultParts.push(text.slice(lastIndex, i));
			let j = i + 1;
			while (j < length) {
				if (text[j] === '"') {
					if (j + 1 < length && text[j + 1] === '"') { j += 2; continue; }
					break;
				}
				j += 1;
			}
			if (j >= length) { resultParts.push(text.slice(i)); lastIndex = length; break; }
			const originalLiteral = text.slice(i, j + 1);
			const inner = originalLiteral.slice(1, -1);
			const unescaped = inner.replace(/""/g, '"');
			if (/select/i.test(unescaped)) {
				const processed = processSqlContent(unescaped);
				if (processed.result !== unescaped) {
					const reescaped = processed.result.replace(/"/g, '""');
					const rebuilt = '"' + reescaped + '"';
					resultParts.push(rebuilt);
					totalTables += processed.tablesChanged;
					totalStatements += processed.statementsChanged > 0 ? processed.statementsChanged : 0;
					lastIndex = j + 1; i = j + 1; continue;
				}
			}
			resultParts.push(originalLiteral);
			lastIndex = j + 1; i = j + 1; continue;
		}
		i += 1;
	}

	if (lastIndex < length) resultParts.push(text.slice(lastIndex));
	const result = resultParts.join('');
	const changed = result !== text;
	return { result: changed ? result : text, statementsChanged: totalStatements, tablesChanged: totalTables };
}

module.exports = { processSqlContent, processTextWithEmbeddedSql };

