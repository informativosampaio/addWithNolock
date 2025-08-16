const fs = require('fs').promises;
const path = require('path');

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

async function corrigirFromEJoinSemNoLock() {
  const arquivos = await listarArquivos(ROOT_DIR);
  let totalFromCorrigidos = 0;
  let totalJoinCorrigidos = 0;

  // Regex mais seguro com \b para fim de palavra
  const regexFromSemNoLock = /FROM\s+([a-zA-Z0-9_\[\]\.]+)\b(?!\s+WITH\s*\(NOLOCK\))/gi;

  // JOIN <tabela> com ON — sem NOLOCK no meio
  const regexJoinSemNoLock = /JOIN\s+([a-zA-Z0-9_\[\]\.]+)\b(?!\s+WITH\s*\(NOLOCK\))(?=\s+ON\b)/gi;

  for (const arquivo of arquivos) {
    try {
      let conteudo = await fs.readFile(arquivo, 'utf-8');
      let atualizado = false;

      // Corrige FROM
      const fromMatch = conteudo.match(regexFromSemNoLock);
      if (fromMatch) {
        conteudo = conteudo.replace(regexFromSemNoLock, 'FROM $1 WITH (NOLOCK)');
        totalFromCorrigidos += fromMatch.length;
        atualizado = true;
      }

      // Corrige JOIN
      const joinMatch = conteudo.match(regexJoinSemNoLock);
      if (joinMatch) {
        conteudo = conteudo.replace(regexJoinSemNoLock, 'JOIN $1 WITH (NOLOCK)');
        totalJoinCorrigidos += joinMatch.length;
        atualizado = true;
      }

      if (atualizado) {
        await fs.writeFile(arquivo, conteudo, 'utf-8');
        console.log(`✅ Corrigido: ${arquivo}`);
      }

    } catch (err) {
      console.warn(`Erro ao processar ${arquivo}: ${err.message}`);
    }
  }

  console.log(`\n🛠️ Correções aplicadas:`);
  console.log(`- FROM sem NOLOCK: ${totalFromCorrigidos}`);
  console.log(`- JOIN sem NOLOCK: ${totalJoinCorrigidos}`);
}

corrigirFromEJoinSemNoLock();
