-- =====================================================================
-- Diagnóstico do esquema (somente leitura)
-- =====================================================================
-- Rode no SQL Editor do Supabase ANTES de aplicar as migrations da
-- FASE 1 e confira se o resultado bate com o esperado pelo código.
-- Nenhuma consulta abaixo altera dados.
-- =====================================================================

-- 1. Colunas e tipos
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('transacoes', 'parcelamentos', 'categorias')
 order by table_name, ordinal_position;

-- 2. Chaves e constraints (inclui regra ON DELETE das FKs)
select tc.table_name, tc.constraint_name, tc.constraint_type,
       pg_get_constraintdef(pgc.oid) as definicao
  from information_schema.table_constraints tc
  join pg_constraint pgc on pgc.conname = tc.constraint_name
 where tc.table_schema = 'public'
   and tc.table_name in ('transacoes', 'parcelamentos', 'categorias')
 order by tc.table_name, tc.constraint_type;

-- 3. RLS habilitado?
select relname as tabela, relrowsecurity as rls_ativo, relforcerowsecurity as rls_forcado
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('transacoes', 'parcelamentos', 'categorias');

-- 4. Políticas de RLS
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('transacoes', 'parcelamentos', 'categorias')
 order by tablename, cmd;

-- 5. Triggers existentes
select event_object_table as tabela, trigger_name, action_timing, event_manipulation
  from information_schema.triggers
 where event_object_schema = 'public'
   and event_object_table in ('transacoes', 'parcelamentos');

-- 6. Consistência atual dos parcelamentos
--    (diferença entre valor_total e a soma das parcelas; contagem real)
select p.id, p.nome, p.total_parcelas, count(t.id) as parcelas_existentes,
       p.valor_total, coalesce(sum(t.valor_estimado), 0) as soma_parcelas,
       p.valor_total - coalesce(sum(t.valor_estimado), 0) as diferenca
  from public.parcelamentos p
  left join public.transacoes t on t.parcelamento_id = p.id
 group by p.id
having p.valor_total <> coalesce(sum(t.valor_estimado), 0)
    or p.total_parcelas <> count(t.id);

-- 7. Funções da FASE 1 já instaladas?
select proname, pg_get_function_identity_arguments(oid) as argumentos
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('criar_parcelamento', 'editar_parcela', 'excluir_parcela',
                   'excluir_parcelamento', 'fase1_recalcular_parcelamento');
