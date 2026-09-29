#!/usr/bin/env node
/**
 * Junta as migrations num arquivo unico, para colar de uma vez no SQL Editor
 * de um projeto Supabase novo.
 *
 *   node scripts/gerar-schema.js
 *
 * Duas transformacoes acontecem aqui, e as duas tem motivo:
 *
 * 1. CREATE INDEX CONCURRENTLY vira CREATE INDEX.
 *    CONCURRENTLY nao roda dentro de transacao, e o SQL Editor do Supabase
 *    envolve o script inteiro em uma. Ele existe para nao travar escrita numa
 *    tabela grande e viva; num banco recem-criado nao ha escrita para travar,
 *    entao o indice sai instantaneo e a protecao nao faz falta. Nas migrations
 *    originais ele continua, porque la rodava contra producao.
 *
 * 2. A migration de simplificacao vai por ultimo, sempre.
 *    Ela derruba cobranca, admin e GTM, entao precisa rodar depois de tudo que
 *    cria essas tabelas.
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const dir = path.join(raiz, 'supabase', 'migrations');
const saida = path.join(raiz, 'supabase', 'schema_completo.sql');

const SIMPLIFICACAO = '20260816000000_single_user_simplification.sql';

/**
 * Migrations puladas, com o motivo.
 *
 * phase1_backfill_workspace_id preenche workspace_id em linhas que ja existiam
 * quando o multi-tenant foi introduzido. Num banco vazio nao ha linha nenhuma
 * para preencher, entao ela e no-op — e quebra: usa CREATE TEMP TABLE, e o SQL
 * Editor do Supabase fala com o banco atraves de um pooler, onde a tabela
 * temporaria nao sobrevive de uma instrucao para a seguinte (erro 42P01).
 */
const PULAR = new Map([
  ['20260401000002_phase1_backfill_workspace_id.sql',
   'backfill de dados: no-op em banco vazio, e usa CREATE TEMP, que nao sobrevive ao pooler'],
]);

const arquivos = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// Garante que a simplificacao seja a ultima, independente da ordem alfabetica.
const aplicaveis = arquivos.filter((f) => !PULAR.has(f));

const ordenados = [
  ...aplicaveis.filter((f) => f !== SIMPLIFICACAO),
  ...aplicaveis.filter((f) => f === SIMPLIFICACAO),
];

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
  `-- ${ordenados.length} migrations, geradas em ${new Date().toISOString().slice(0, 10)}.`,
  '-- ============================================================',
  '',
];

let concurrentlyRemovidos = 0;

for (const [arquivo, motivo] of PULAR) {
  partes.push(`-- PULADA: ${arquivo}`, `--   ${motivo}`, '');
}

for (const arquivo of ordenados) {
  let sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');

  const antes = (sql.match(/CONCURRENTLY/g) || []).length;
  sql = sql.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi, (_m, unique) =>
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX`,
  );
  concurrentlyRemovidos += antes - (sql.match(/CONCURRENTLY/g) || []).length;

  partes.push(`-- >>>>>>>>>>>>>>>>>>>> ${arquivo} <<<<<<<<<<<<<<<<<<<<`, '', sql, '');
}

fs.writeFileSync(saida, partes.join('\n'));

const texto = fs.readFileSync(saida, 'utf8');
console.log(`Gerado supabase/schema_completo.sql`);
console.log(`  ${ordenados.length} migrations aplicadas, ${PULAR.size} pulada(s)`);
console.log(`  ${texto.split('\n').length} linhas`);
console.log(`  ${concurrentlyRemovidos} CONCURRENTLY removidos`);
console.log(`  ultima migration: ${ordenados[ordenados.length - 1]}`);
