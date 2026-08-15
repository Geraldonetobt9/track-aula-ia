#!/usr/bin/env bash
# Junta as migrations num arquivo unico, para colar de uma vez no SQL Editor.
# Rode a partir da raiz do projeto:  bash scripts/gerar-schema.sh
set -euo pipefail

cd "$(dirname "$0")/.."
saida="supabase/schema_completo.sql"

{
  echo "-- ============================================================"
  echo "-- SCHEMA COMPLETO — Dashboard Anibal"
  echo "-- ============================================================"
  echo "-- ARQUIVO GERADO. Nao edite aqui: edite os arquivos de"
  echo "-- migrations/ e gere de novo com scripts/gerar-schema.sh"
  echo "--"
  echo "-- Cole tudo isto no SQL Editor de um projeto Supabase NOVO E VAZIO"
  echo "-- e execute uma vez so."
  echo "-- ============================================================"
  echo ""
  for f in supabase/migrations/*.sql; do
    echo ""
    echo "-- >>>>>>>>>>>>>>>>>>>> $(basename "$f") <<<<<<<<<<<<<<<<<<<<"
    echo ""
    cat "$f"
  done
} > "$saida"

echo "Gerado $saida — $(grep -c '^CREATE TABLE public\.' "$saida") tabelas"
