const fs = require('fs').promises;
const path = require('path');
const { processTextWithEmbeddedSql } = require('./sql-nolock-cli/src/processor');

const ROOT_DIR = 'C:\\Sites\\sistema-contel\\conteltelecom\\CRON';
const EXTENSOES_VALIDAS = ['.vb', '.js', '.aspx.vb'];

async function listarArquivos(dir) {
  let arquivos = [];
  const itens = await fs.readdir(dir, { withFileTypes: true });

  for (const item of itens) {
    const caminho = path.join(dir, item.name);
    if (item.isDirectory()) {
      arquivos = arquivos.concat(await listarArquivos(caminho));
    } else {
      const ext = path.extname(caminho).toLowerCase();
      const nome = path.basename(caminho).toLowerCase();

      if (
        EXTENSOES_VALIDAS.includes(ext) ||
        nome.endsWith('.aspx.vb')
      ) {
        arquivos.push(caminho);
      }
    }
  }

  return arquivos;
}

async function corrigirWithNoLockEmStringsSql() {
  const arquivos = await listarArquivos(ROOT_DIR);
  let totalArquivosAlterados = 0;
  let totalSelectsAlterados = 0;
  let totalTabelasAlteradas = 0;

  for (const arquivo of arquivos) {
    try {
      const conteudo = await fs.readFile(arquivo, 'utf-8');
      const { result, statementsChanged, tablesChanged } = processTextWithEmbeddedSql(conteudo);
      if (result !== conteudo) {
        await fs.writeFile(arquivo, result, 'utf-8');
        totalArquivosAlterados += 1;
        totalSelectsAlterados += statementsChanged;
        totalTabelasAlteradas += tablesChanged;
        console.log(`✅ Corrigido: ${arquivo} (${tablesChanged} tabelas em ${statementsChanged} SELECTs)`);
      }
    } catch (err) {
      console.warn(`Erro ao processar ${arquivo}: ${err.message}`);
    }
  }

  console.log(`\n🛠️ Correções aplicadas:`);
  console.log(`- Arquivos alterados: ${totalArquivosAlterados}`);
  console.log(`- Tabelas com NOLOCK inserido/ajustado: ${totalTabelasAlteradas}`);
  console.log(`- SELECTs impactados: ${totalSelectsAlterados}`);
}

corrigirWithNoLockEmStringsSql();