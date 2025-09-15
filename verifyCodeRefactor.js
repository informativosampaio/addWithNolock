const path = require('path');
const fs = require('fs');

const ROOT_DIR = process.env.TARGET_PATH || process.env.SCAN_ROOT || 'C:\\Sites\\sistema-contel\\conteltelecom\\CRON';
const INCLUDE_EXTENSIONS = new Set(['.aspx', '.aspx.vb', '.vb']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', '.vscode', '.idea']);

// Array para armazenar os erros encontrados
const foundErrors = [];

const checkSyntax = (sqlString, filePath) => {
    const selectCommands = sqlString.match(/SELECT\s+[\s\S]*?(?=;|\n{2,}|$)/gi);

    if (selectCommands) {
        selectCommands.forEach(cmd => {
            // ... (validações anteriores)

            // Validação de WITH (NOLOCK)
            const nolockRegex = /\sWITH \(NOLOCK\)/i;
            const nolockMatch = cmd.match(nolockRegex);

            if (nolockMatch) {
                const startIndex = nolockMatch.index;
                const afterNolockIndex = startIndex + nolockMatch[0].length;
                const charAfterNolock = cmd.substring(afterNolockIndex, afterNolockIndex + 1);

                // Exceção: se o caractere após o ')' for uma aspas duplas ou simples, ignore a necessidade do espaço
                if (charAfterNolock === '"' || charAfterNolock === "'" || charAfterNolock === ',' || charAfterNolock === ")") {
                    // A regra é ignorada, então não faz nada
                } else if (charAfterNolock !== ' ' && charAfterNolock !== '' && charAfterNolock !== '\n' && charAfterNolock !== '\r') {
                    foundErrors.push({
                        file: filePath,
                        error: "Erro de espaçamento em 'WITH (NOLOCK)'. O padrão deve ter um espaço antes e depois do trecho (exceto se for seguido por aspas).",
                        codeSnippet: cmd.trim()
                    });
                }
            }
        });
    }
};

const scanDirectory = (dir) => {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory() && !IGNORE_DIRS.has(file)) {
            scanDirectory(filePath);
        } else if (stats.isFile() && INCLUDE_EXTENSIONS.has(path.extname(file))) {
            const content = fs.readFileSync(filePath, 'utf-8');
            checkSyntax(content, filePath);
        }
    });
};

// Execução
try {
    console.log(`Iniciando a varredura em: ${ROOT_DIR}`);
    scanDirectory(ROOT_DIR);

    if (foundErrors.length > 0) {
        console.log('\n--- Erros de sintaxe SQL encontrados ---');
        foundErrors.forEach(error => {
            console.log(`\nArquivo: ${error.file}`);
            console.log(`Erro: ${error.error}`);
            console.log(`Trecho de código:\n${error.codeSnippet}`);
        });
        console.log('\nVarredura concluída com erros.');
    } else {
        console.log('\nNenhum erro de sintaxe SQL aparente encontrado. Varredura concluída.');
    }
} catch (error) {
    console.error(`Erro ao executar a varredura: ${error.message}`);
}