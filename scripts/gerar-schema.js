#!/usr/bin/env node
/**
 * Junta as migrations num arquivo unico, para colar de uma vez no SQL Editor
 * de um projeto Supabase novo.
 *
 *   node scripts/gerar-schema.js
 *
 * A primeira migration e a base (20261002120000_base.sql): o banco inteiro
 * ate a consolidacao. As seguintes sao as mudancas feitas depois dela, em
 * ordem de data.
 *
 * Uma transformacao acontece aqui: CREATE INDEX CONCURRENTLY vira CREATE
 * INDEX. CONCURRENTLY nao roda dentro de transacao, e o SQL Editor do
 * Supabase envolve o script inteiro em uma. Ele existe para nao travar
 * escrita numa tabela grande e viva; num banco recem-criado nao ha escrita
 * para travar, entao o indice sai instantaneo e a protecao nao faz falta. Na
 * migration original ele continua, porque la roda contra producao.
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const dir = path.join(raiz, 'supabase', 'migrations');
const saida = path.join(raiz, 'supabase', 'schema_completo.sql');

const arquivos = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const partes = [
  '-- ============================================================',
  '-- SCHEMA COMPLETO — Dashboard de Tracking',
  '-- ============================================================',
  '-- ARQUIVO GERADO. Nao edite aqui: edite supabase/migrations/ e rode',
  '--   node scripts/gerar-schema.js',
  '--',
  '-- Cole no SQL Editor de um projeto Supabase NOVO E VAZIO e execute uma vez.',
  '-- Se o banco ja tiver algo, rode supabase/reset.sql antes.',
  '--',
  `-- ${arquivos.length} migration(s), gerado em ${new Date().toISOString().slice(0, 10)}.`,
  '-- ============================================================',
  '',
];

let concurrentlyRemovidos = 0;

for (const arquivo of arquivos) {
  let sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');

  const antes = (sql.match(/CONCURRENTLY/g) || []).length;
  sql = sql.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi, (_m, unique) =>
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX`,
  );
  concurrentlyRemovidos += antes - (sql.match(/CONCURRENTLY/g) || []).length;

  partes.push(`-- ==================== ${arquivo} ====================`, '', sql, '');
}

fs.writeFileSync(saida, partes.join('\n'));

const texto = fs.readFileSync(saida, 'utf8');
console.log(`Gerado supabase/schema_completo.sql`);
console.log(`  ${arquivos.length} migration(s)`);
console.log(`  ${texto.split('\n').length} linhas`);
console.log(`  ${concurrentlyRemovidos} CONCURRENTLY removidos`);
console.log(`  ultima migration: ${arquivos[arquivos.length - 1]}`);
