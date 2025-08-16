const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { processTextWithEmbeddedSql } = require('./processor');

function printHelp() {
	console.log(`
Uso: nolock-sql [opções]

Aplica WITH (NOLOCK) em tabelas referenciadas em comandos SELECT dentro de arquivos.

Opções:
  -d, --dir <caminho>       Diretório base para varrer (padrão: $NOLOCK_SQL_DIR ou diretório atual)
  -e, --ext <lista>         Extensões separadas por vírgula (padrão: .aspc,.aspx.vb)
      --dry-run             Não grava alterações; apenas mostra o que seria alterado
      --backup              Cria <arquivo>.bak antes de salvar
      --no-recursive        Não varrer recursivamente
      --encoding <enc>      Encoding de leitura/escrita (padrão: utf8)
  -h, --help                Mostra esta ajuda

Exemplos:
  nolock-sql --dir ./src
  nolock-sql -d "C:\\Sites\\sistema-contel\\conteltelecom\\CRON"
  NOLOCK_SQL_DIR=/projetos/web nolock-sql
`);
}

function resolveDirInput(val) {
	if (!val) return val;
	// Aceitar absolutos em ambos os formatos (Windows/POSIX)
	if (path.isAbsolute(val) || path.win32.isAbsolute(val)) return val;
	return path.resolve(val);
}

function parseArgs(argv) {
	const options = {
		dir: resolveDirInput(process.env.NOLOCK_SQL_DIR) || process.cwd(),
		extensions: ['.aspc', '.aspx.vb'],
		dryRun: false,
		backup: false,
		recursive: true,
		encoding: 'utf8',
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '-h' || arg === '--help') {
			options.help = true;
			continue;
		}
		if (arg === '-d' || arg === '--dir') {
			const val = argv[i + 1];
			if (!val) throw new Error('Faltou valor para --dir');
			options.dir = resolveDirInput(val);
			i += 1;
			continue;
		}
		if (arg === '-e' || arg === '--ext') {
			const val = argv[i + 1];
			if (!val) throw new Error('Faltou valor para --ext');
			options.extensions = val.split(',').map((s) => s.trim()).filter(Boolean);
			i += 1;
			continue;
		}
		if (arg === '--dry-run') {
			options.dryRun = true;
			continue;
		}
		if (arg === '--backup') {
			options.backup = true;
			continue;
		}
		if (arg === '--no-recursive') {
			options.recursive = false;
			continue;
		}
		if (arg === '--encoding') {
			const val = argv[i + 1];
			if (!val) throw new Error('Faltou valor para --encoding');
			options.encoding = val;
			i += 1;
			continue;
		}
		throw new Error(`Argumento desconhecido: ${arg}`);
	}

	return options;
}

async function listFilesRecursively(baseDir, recursive, extensions) {
	const results = [];
	const stack = [baseDir];
	const ignoredDirs = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'bin', 'obj']);

	while (stack.length) {
		const currentDir = stack.pop();
		let entries;
		try {
			entries = await fsp.readdir(currentDir, { withFileTypes: true });
		} catch (err) {
			console.warn(`[nolock-sql] Não foi possível ler diretório: ${currentDir} (${err.message})`);
			continue;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				if (ignoredDirs.has(entry.name)) continue;
				if (recursive) stack.push(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			const nameLower = entry.name.toLowerCase();
			// Suportar extensões com múltiplos pontos (ex: .aspx.vb)
			const match = extensions.some((ext) => nameLower.endsWith(ext.toLowerCase()));
			if (!match) continue;
			results.push(fullPath);
		}
	}

	return results;
}

async function processFile(filePath, encoding, dryRun, backup) {
	let content;
	try {
		content = await fsp.readFile(filePath, { encoding });
	} catch (err) {
		console.warn(`[nolock-sql] Falha ao ler ${filePath}: ${err.message}`);
		return { filePath, changed: false, statementsChanged: 0, tablesChanged: 0 };
	}

	const { result, statementsChanged, tablesChanged } = processTextWithEmbeddedSql(content);
	const changed = result !== content;

	if (changed && !dryRun) {
		try {
			if (backup) {
				await fsp.writeFile(`${filePath}.bak`, content, { encoding });
			}
			await fsp.writeFile(filePath, result, { encoding });
		} catch (err) {
			console.warn(`[nolock-sql] Falha ao escrever ${filePath}: ${err.message}`);
		}
	}

	return { filePath, changed, statementsChanged, tablesChanged };
}

async function runCli() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	console.log(`[nolock-sql] Diretório base: ${options.dir}`);
	console.log(`[nolock-sql] Extensões: ${options.extensions.join(', ')}`);
	if (options.dryRun) console.log('[nolock-sql] Modo: dry-run (não grava alterações)');
	if (options.backup) console.log('[nolock-sql] Backup: habilitado (.bak)');
	if (!options.recursive) console.log('[nolock-sql] Recursivo: desabilitado');

	const files = await listFilesRecursively(options.dir, options.recursive, options.extensions);
	if (!files.length) {
		console.log('[nolock-sql] Nenhum arquivo encontrado.');
		return;
	}

	let totalChangedFiles = 0;
	let totalStatementsChanged = 0;
	let totalTablesChanged = 0;

	for (const filePath of files) {
		const { changed, statementsChanged, tablesChanged } = await processFile(filePath, options.encoding, options.dryRun, options.backup);
		if (changed) {
			totalChangedFiles += 1;
			totalStatementsChanged += statementsChanged;
			totalTablesChanged += tablesChanged;
			console.log(`[ALTERADO] ${filePath} (${tablesChanged} tabelas em ${statementsChanged} SELECTs)`);
		}
	}

	console.log(`[nolock-sql] Concluído. Arquivos alterados: ${totalChangedFiles}. Tabelas afetadas: ${totalTablesChanged}. SELECTs alterados: ${totalStatementsChanged}.`);
}

module.exports = { runCli };