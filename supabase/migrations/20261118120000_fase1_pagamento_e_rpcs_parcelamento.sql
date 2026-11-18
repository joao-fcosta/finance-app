-- =====================================================================
-- FASE 1 — Controle de pagamento e operações atômicas de parcelamento
-- =====================================================================
--
-- Validada contra o esquema real do projeto em 2026-11-18 (somente
-- leitura via MCP do Supabase).
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. Confere se o esquema real é compatível com o que o código usa.
--      Se algo divergir, ABORTA com uma mensagem clara, sem alterar nada.
--
--   2. Adiciona a `transacoes`:
--        - status_pagamento  text NULL  ('pendente' | 'pago')
--        - pago_em           timestamptz NULL
--      As colunas são criadas SEM default: todos os registros existentes
--      ficam com status_pagamento = NULL ("sem status"). O sistema NÃO
--      presume que foram pagos nem que estão atrasados. O default
--      'pendente' é aplicado depois e vale APENAS para registros novos.
--
--   3. Adiciona a `parcelamentos`:
--        - valor_contratado  numeric(10,2) NOT NULL
--      Valor original da compra. Nos registros existentes recebe o
--      valor_total atual (ex.: um parcelamento cujas parcelas somam
--      545,28 mas foi contratado por 548,46 preserva 548,46).
--      A partir daqui:
--        - valor_contratado = valor original (nunca recalculado);
--        - valor_total      = soma atual das parcelas (recalculada
--                             pelas funções RPC).
--
--   4. Garante a propriedade conjunta parcela ↔ parcelamento:
--      troca a FK simples transacoes(parcelamento_id) pela FK composta
--      transacoes(parcelamento_id, usuario_id) → parcelamentos(id, usuario_id)
--      ON DELETE CASCADE. Assim uma transação de um usuário não pode
--      referenciar o parcelamento de outro. Aborta se algum registro
--      existente violar essa regra (nenhum registro é alterado).
--
--   5. Cria funções RPC (plpgsql) para as operações compostas:
--        - criar_parcelamento
--        - editar_parcela          (escopo 'unica' ou 'futuras')
--        - excluir_parcela
--        - excluir_parcelamento
--      Todas são SECURITY INVOKER: rodam com as permissões do usuário
--      autenticado, então o RLS existente continua valendo. Além disso,
--      cada função filtra explicitamente por usuario_id = auth.uid().
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
--   - Não remove nem renomeia colunas.
--   - Não altera políticas de RLS.
--   - Não altera valores, meses, nomes ou totais de registros existentes
--     (a única escrita em dados é o preenchimento de valor_contratado,
--     que é uma coluna nova).
--
-- COMO APLICAR
--
--   Via MCP do Supabase (apply_migration). A ferramenta executa o arquivo
--   dentro de uma transação: por isso não há BEGIN/COMMIT aqui. Se algum
--   comando falhar, nada é aplicado.
--
--   Para aplicar pelo SQL Editor, envolva o conteúdo em BEGIN; ... COMMIT;
--
-- REEXECUÇÃO
--   Todos os comandos são idempotentes: a migration pode ser executada
--   novamente sem efeitos colaterais.
--
-- ROLLBACK
--   Ver bloco comentado ao final do arquivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Verificação do esquema real
-- ---------------------------------------------------------------------
do $$
declare
  v_faltando text[];
  v_tipo text;
  v_divergentes integer;
begin
  if to_regclass('public.transacoes') is null then
    raise exception 'FASE 1: tabela public.transacoes não encontrada.';
  end if;

  if to_regclass('public.parcelamentos') is null then
    raise exception 'FASE 1: tabela public.parcelamentos não encontrada.';
  end if;

  select array_agg(c) into v_faltando
  from unnest(array[
    'id', 'usuario_id', 'nome', 'mes_referencia', 'valor_estimado',
    'valor_real', 'tipo', 'categoria_id', 'parcelamento_id', 'numero_parcela'
  ]) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transacoes' and column_name = c
  );

  if v_faltando is not null then
    raise exception 'FASE 1: colunas ausentes em transacoes: %', v_faltando;
  end if;

  select array_agg(c) into v_faltando
  from unnest(array['id', 'usuario_id', 'nome', 'total_parcelas', 'valor_total']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parcelamentos' and column_name = c
  );

  if v_faltando is not null then
    raise exception 'FASE 1: colunas ausentes em parcelamentos: %', v_faltando;
  end if;

  select data_type into v_tipo from information_schema.columns
  where table_schema = 'public' and table_name = 'transacoes' and column_name = 'mes_referencia';
  if v_tipo not in ('text', 'character varying', 'character') then
    raise exception 'FASE 1: transacoes.mes_referencia deveria ser texto (YYYY-MM), encontrado: %', v_tipo;
  end if;

  select data_type into v_tipo from information_schema.columns
  where table_schema = 'public' and table_name = 'transacoes' and column_name = 'tipo';
  if v_tipo not in ('text', 'character varying', 'character') then
    raise exception 'FASE 1: transacoes.tipo deveria ser texto, encontrado: %', v_tipo;
  end if;

  select data_type into v_tipo from information_schema.columns
  where table_schema = 'public' and table_name = 'transacoes' and column_name = 'id';
  if v_tipo <> 'uuid' then
    raise exception 'FASE 1: transacoes.id deveria ser uuid, encontrado: %', v_tipo;
  end if;

  select data_type into v_tipo from information_schema.columns
  where table_schema = 'public' and table_name = 'parcelamentos' and column_name = 'id';
  if v_tipo <> 'uuid' then
    raise exception 'FASE 1: parcelamentos.id deveria ser uuid, encontrado: %', v_tipo;
  end if;

  select data_type into v_tipo from information_schema.columns
  where table_schema = 'public' and table_name = 'parcelamentos' and column_name = 'valor_total';
  if v_tipo <> 'numeric' then
    raise exception 'FASE 1: parcelamentos.valor_total deveria ser numeric, encontrado: %', v_tipo;
  end if;

  -- Propriedade conjunta: não aplicamos a FK composta se algum registro
  -- existente a violaria. Nenhum dado é corrigido automaticamente.
  select count(*) into v_divergentes
    from public.transacoes t
    join public.parcelamentos p on p.id = t.parcelamento_id
   where t.usuario_id <> p.usuario_id;

  if v_divergentes > 0 then
    raise exception 'FASE 1: % transação(ões) referenciam parcelamento de outro usuário. Corrija manualmente antes de aplicar.', v_divergentes;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.transacoes'::regclass) then
    raise warning 'FASE 1: RLS está DESLIGADO em public.transacoes. Verifique as políticas.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.parcelamentos'::regclass) then
    raise warning 'FASE 1: RLS está DESLIGADO em public.parcelamentos. Verifique as políticas.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Colunas de pagamento (transacoes)
-- ---------------------------------------------------------------------

-- Sem DEFAULT na criação: registros existentes ficam NULL ("sem status").
alter table public.transacoes
  add column if not exists status_pagamento text,
  add column if not exists pago_em timestamptz;

comment on column public.transacoes.status_pagamento is
  'Estado de pagamento: pendente | pago. NULL = registro anterior à FASE 1, estado desconhecido (não presumir).';
comment on column public.transacoes.pago_em is
  'Momento em que a transação foi marcada como paga. Preenchido somente quando status_pagamento = pago.';

alter table public.transacoes
  drop constraint if exists transacoes_status_pagamento_check;
alter table public.transacoes
  add constraint transacoes_status_pagamento_check
  check (status_pagamento is null or status_pagamento in ('pendente', 'pago'));

-- pago_em existe se, e somente se, o status for 'pago'.
alter table public.transacoes
  drop constraint if exists transacoes_pago_em_consistente_check;
alter table public.transacoes
  add constraint transacoes_pago_em_consistente_check
  check (
    (status_pagamento = 'pago' and pago_em is not null)
    or (status_pagamento is distinct from 'pago' and pago_em is null)
  );

-- Default aplicado DEPOIS de criar a coluna: vale só para novos registros.
alter table public.transacoes
  alter column status_pagamento set default 'pendente';

-- Acelera a listagem de parcelas de um parcelamento.
create index if not exists transacoes_parcelamento_numero_idx
  on public.transacoes (parcelamento_id, numero_parcela)
  where parcelamento_id is not null;

-- ---------------------------------------------------------------------
-- 3. Valor contratado (parcelamentos)
-- ---------------------------------------------------------------------

alter table public.parcelamentos
  add column if not exists valor_contratado numeric(10,2);

comment on column public.parcelamentos.valor_contratado is
  'Valor original da compra no momento da criação. Não é recalculado. valor_total = soma atual das parcelas.';
comment on column public.parcelamentos.valor_total is
  'Soma atual das parcelas. Recalculada pelas funções RPC da FASE 1. Ver valor_contratado para o valor original.';

-- Preserva o valor atual nos registros existentes (só preenche vazios,
-- então reexecutar não altera nada).
update public.parcelamentos
   set valor_contratado = valor_total
 where valor_contratado is null;

-- Garante valor_contratado em inserções que não o informem (por exemplo,
-- uma versão anterior do app ainda em execução durante o deploy).
create or replace function public.fase1_parcelamentos_valor_contratado()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.valor_contratado := coalesce(new.valor_contratado, new.valor_total);
  return new;
end
$$;

drop trigger if exists fase1_parcelamentos_valor_contratado on public.parcelamentos;
create trigger fase1_parcelamentos_valor_contratado
  before insert on public.parcelamentos
  for each row execute function public.fase1_parcelamentos_valor_contratado();

alter table public.parcelamentos
  alter column valor_contratado set not null;

alter table public.parcelamentos
  drop constraint if exists parcelamentos_valor_contratado_check;
alter table public.parcelamentos
  add constraint parcelamentos_valor_contratado_check
  check (valor_contratado > 0);

-- ---------------------------------------------------------------------
-- 4. Propriedade conjunta parcela ↔ parcelamento
-- ---------------------------------------------------------------------
-- A FK simples permitia que uma transação do usuário A apontasse para o
-- parcelamento do usuário B (a checagem de FK ignora o RLS).
--
-- Solução: FK composta (parcelamento_id, usuario_id) → (id, usuario_id).
--   - MATCH SIMPLE (padrão): transações sem parcelamento (NULL) não são
--     afetadas.
--   - ON DELETE CASCADE preservado: excluir o parcelamento exclui suas
--     parcelas, como antes.
--   - A FK simples antiga é removida porque a composta a substitui por
--     completo. Manter as duas tornaria ambíguo o relacionamento
--     transacoes ↔ parcelamentos para o PostgREST (erro PGRST201).

-- Chave alvo da FK composta.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.parcelamentos'::regclass
       and conname = 'parcelamentos_id_usuario_key'
  ) then
    alter table public.parcelamentos
      add constraint parcelamentos_id_usuario_key unique (id, usuario_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.transacoes'::regclass
       and conname = 'transacoes_parcelamento_usuario_fkey'
  ) then
    alter table public.transacoes
      add constraint transacoes_parcelamento_usuario_fkey
      foreign key (parcelamento_id, usuario_id)
      references public.parcelamentos (id, usuario_id)
      on delete cascade;
  end if;
end
$$;

alter table public.transacoes
  drop constraint if exists transacoes_parcelamento_id_fkey;

-- ---------------------------------------------------------------------
-- 5. Funções auxiliares (internas)
-- ---------------------------------------------------------------------

-- Soma meses a um "YYYY-MM".
create or replace function public.fase1_somar_meses(p_mes text, p_meses integer)
returns text
language sql
immutable
set search_path = public
as $$
  select to_char(to_date(p_mes || '-01', 'YYYY-MM-DD') + make_interval(months => p_meses), 'YYYY-MM')
$$;

-- Diferença em meses entre dois "YYYY-MM" (p_ate - p_de).
create or replace function public.fase1_diferenca_meses(p_de text, p_ate text)
returns integer
language sql
immutable
set search_path = public
as $$
  select (split_part(p_ate, '-', 1)::int * 12 + split_part(p_ate, '-', 2)::int)
       - (split_part(p_de, '-', 1)::int * 12 + split_part(p_de, '-', 2)::int)
$$;

-- Remove o sufixo " (3/12)" de um nome de parcela.
create or replace function public.fase1_nome_base(p_nome text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(coalesce(p_nome, ''), '\s*\(\d+/\d+\)\s*$', ''))
$$;

-- Mantém valor_total igual à soma das parcelas existentes.
-- NÃO altera valor_contratado.
create or replace function public.fase1_recalcular_parcelamento(p_parcelamento_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.parcelamentos p
     set valor_total = coalesce((
           select sum(t.valor_estimado)
             from public.transacoes t
            where t.parcelamento_id = p.id
              and t.usuario_id = auth.uid()
         ), 0)
   where p.id = p_parcelamento_id
     and p.usuario_id = auth.uid();
end
$$;

-- ---------------------------------------------------------------------
-- 6. RPC: criar_parcelamento
-- ---------------------------------------------------------------------
-- Cria o parcelamento e todas as parcelas em uma única transação.
-- Os valores de cada parcela são calculados pela aplicação (distribuição
-- em centavos) e conferidos aqui.
create or replace function public.criar_parcelamento(
  p_nome text,
  p_tipo text,
  p_categoria_id integer,
  p_mes_inicio text,
  p_valores numeric[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text := btrim(coalesce(p_nome, ''));
  v_qtd integer := coalesce(array_length(p_valores, 1), 0);
  v_total numeric := 0;
  v_parcelamento_id uuid;
  v_valor numeric;
  i integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if v_nome = '' then
    raise exception 'Informe o nome da compra.' using errcode = '22023';
  end if;

  if length(v_nome) > 200 then
    raise exception 'O nome deve ter no máximo 200 caracteres.' using errcode = '22023';
  end if;

  if p_tipo not in ('receita', 'despesa') then
    raise exception 'Tipo de transação inválido.' using errcode = '22023';
  end if;

  if p_mes_inicio !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mês de referência inválido.' using errcode = '22023';
  end if;

  if v_qtd < 2 or v_qtd > 420 then
    raise exception 'Quantidade de parcelas inválida.' using errcode = '22023';
  end if;

  foreach v_valor in array p_valores loop
    if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
      raise exception 'Valor de parcela inválido: %', v_valor using errcode = '22023';
    end if;
    v_total := v_total + v_valor;
  end loop;

  -- Limite de numeric(10,2).
  if v_total > 99999999.99 then
    raise exception 'O valor total excede o limite de R$ 99.999.999,99.' using errcode = '22023';
  end if;

  insert into public.parcelamentos (usuario_id, nome, total_parcelas, valor_total, valor_contratado)
  values (v_uid, v_nome, v_qtd, v_total, v_total)
  returning id into v_parcelamento_id;

  for i in 1..v_qtd loop
    insert into public.transacoes (
      usuario_id, nome, mes_referencia, valor_estimado, tipo, categoria_id,
      parcelamento_id, numero_parcela, status_pagamento, pago_em
    ) values (
      v_uid,
      v_nome || ' (' || i || '/' || v_qtd || ')',
      public.fase1_somar_meses(p_mes_inicio, i - 1),
      p_valores[i],
      p_tipo,
      case when p_tipo = 'despesa' then p_categoria_id else null end,
      v_parcelamento_id,
      i,
      'pendente',
      null
    );
  end loop;

  return v_parcelamento_id;
end
$$;

-- ---------------------------------------------------------------------
-- 7. RPC: editar_parcela
-- ---------------------------------------------------------------------
-- p_escopo = 'unica'
--   Altera SOMENTE a parcela informada. Nenhuma outra parcela é
--   modificada. valor_total é recalculado; valor_contratado não muda.
--   Se a parcela estiver paga, valor e mês não podem mudar.
--
-- p_escopo = 'futuras'
--   Altera a parcela informada e as de número maior, EXCETO as pagas
--   (histórico preservado). Nome e categoria são aplicados; o valor
--   informado passa a valer para cada parcela afetada; se o mês mudar,
--   todas as afetadas são deslocadas pela mesma diferença de meses.
--   O nome do parcelamento também é atualizado.
--
-- Retorna a quantidade de parcelas alteradas.
create or replace function public.editar_parcela(
  p_transacao_id uuid,
  p_escopo text,
  p_nome text,
  p_valor numeric,
  p_mes text,
  p_categoria_id integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_parcela public.transacoes%rowtype;
  v_total_parcelas integer;
  v_nome_base text := public.fase1_nome_base(p_nome);
  v_delta integer;
  v_afetadas integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if p_escopo not in ('unica', 'futuras') then
    raise exception 'Escopo de edição inválido.' using errcode = '22023';
  end if;

  if v_nome_base = '' then
    raise exception 'Informe um nome válido.' using errcode = '22023';
  end if;

  if length(v_nome_base) > 200 then
    raise exception 'O nome deve ter no máximo 200 caracteres.' using errcode = '22023';
  end if;

  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) then
    raise exception 'O valor deve ser maior que zero.' using errcode = '22023';
  end if;

  if p_valor > 99999999.99 then
    raise exception 'O valor excede o limite de R$ 99.999.999,99.' using errcode = '22023';
  end if;

  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mês de referência inválido.' using errcode = '22023';
  end if;

  select * into v_parcela
    from public.transacoes
   where id = p_transacao_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Parcela não encontrada.' using errcode = 'P0002';
  end if;

  if v_parcela.parcelamento_id is null or v_parcela.numero_parcela is null then
    raise exception 'Esta transação não pertence a um parcelamento.' using errcode = '22023';
  end if;

  -- Trava o parcelamento para serializar operações concorrentes.
  select total_parcelas into v_total_parcelas
    from public.parcelamentos
   where id = v_parcela.parcelamento_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Parcelamento não encontrado.' using errcode = 'P0002';
  end if;

  if p_escopo = 'unica' then
    if v_parcela.status_pagamento = 'pago'
       and (p_valor <> v_parcela.valor_estimado or p_mes <> v_parcela.mes_referencia) then
      raise exception 'Esta parcela já foi paga. Desfaça o pagamento para alterar valor ou mês.'
        using errcode = '22023';
    end if;

    update public.transacoes
       set nome = v_nome_base || ' (' || v_parcela.numero_parcela || '/' || v_total_parcelas || ')',
           valor_estimado = p_valor,
           mes_referencia = p_mes,
           categoria_id = case when v_parcela.tipo = 'despesa' then p_categoria_id else null end
     where id = v_parcela.id and usuario_id = v_uid;

    v_afetadas := 1;
  else
    if v_parcela.status_pagamento = 'pago' then
      raise exception 'Esta parcela já foi paga. Escolha uma parcela pendente para editar as próximas.'
        using errcode = '22023';
    end if;

    v_delta := public.fase1_diferenca_meses(v_parcela.mes_referencia, p_mes);

    update public.transacoes
       set nome = v_nome_base || ' (' || numero_parcela || '/' || v_total_parcelas || ')',
           valor_estimado = p_valor,
           mes_referencia = public.fase1_somar_meses(mes_referencia, v_delta),
           categoria_id = case when tipo = 'despesa' then p_categoria_id else null end
     where parcelamento_id = v_parcela.parcelamento_id
       and usuario_id = v_uid
       and numero_parcela >= v_parcela.numero_parcela
       and status_pagamento is distinct from 'pago';

    get diagnostics v_afetadas = row_count;

    update public.parcelamentos
       set nome = v_nome_base
     where id = v_parcela.parcelamento_id and usuario_id = v_uid;
  end if;

  perform public.fase1_recalcular_parcelamento(v_parcela.parcelamento_id);

  return v_afetadas;
end
$$;

-- ---------------------------------------------------------------------
-- 8. RPC: excluir_parcela
-- ---------------------------------------------------------------------
-- Exclui SOMENTE a parcela informada. Regras:
--   - parcela paga não pode ser excluída (preserva histórico);
--   - se for a única parcela restante, é preciso excluir o
--     parcelamento inteiro (evita parcelamento vazio).
-- As demais parcelas não são renumeradas nem alteradas.
-- valor_total e total_parcelas refletem as parcelas restantes;
-- valor_contratado não muda.
create or replace function public.excluir_parcela(p_transacao_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_parcela public.transacoes%rowtype;
  v_restantes integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into v_parcela
    from public.transacoes
   where id = p_transacao_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Parcela não encontrada.' using errcode = 'P0002';
  end if;

  if v_parcela.parcelamento_id is null then
    raise exception 'Esta transação não pertence a um parcelamento.' using errcode = '22023';
  end if;

  perform 1 from public.parcelamentos
   where id = v_parcela.parcelamento_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Parcelamento não encontrado.' using errcode = 'P0002';
  end if;

  if v_parcela.status_pagamento = 'pago' then
    raise exception 'Parcela paga não pode ser excluída. Desfaça o pagamento antes.'
      using errcode = '22023';
  end if;

  select count(*) into v_restantes
    from public.transacoes
   where parcelamento_id = v_parcela.parcelamento_id and usuario_id = v_uid;

  if v_restantes <= 1 then
    raise exception 'Esta é a única parcela restante. Exclua o parcelamento inteiro.'
      using errcode = '22023';
  end if;

  delete from public.transacoes
   where id = v_parcela.id and usuario_id = v_uid;

  update public.parcelamentos
     set total_parcelas = v_restantes - 1
   where id = v_parcela.parcelamento_id and usuario_id = v_uid;

  perform public.fase1_recalcular_parcelamento(v_parcela.parcelamento_id);
end
$$;

-- ---------------------------------------------------------------------
-- 9. RPC: excluir_parcelamento
-- ---------------------------------------------------------------------
-- Exclui o parcelamento e TODAS as suas parcelas (inclusive pagas).
-- A interface exige confirmação explícita antes de chamar.
-- Remove as parcelas explicitamente (não depende só do CASCADE).
-- Retorna a quantidade de parcelas excluídas.
create or replace function public.excluir_parcelamento(p_parcelamento_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_excluidas integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  perform 1 from public.parcelamentos
   where id = p_parcelamento_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Parcelamento não encontrado.' using errcode = 'P0002';
  end if;

  delete from public.transacoes
   where parcelamento_id = p_parcelamento_id and usuario_id = v_uid;

  get diagnostics v_excluidas = row_count;

  delete from public.parcelamentos
   where id = p_parcelamento_id and usuario_id = v_uid;

  return v_excluidas;
end
$$;

-- ---------------------------------------------------------------------
-- 10. Permissões
-- ---------------------------------------------------------------------
-- O projeto concede EXECUTE a anon em toda função nova de public
-- (default privileges). Revogamos de public/anon e concedemos apenas a
-- authenticated. As auxiliares precisam de EXECUTE para authenticated
-- porque são chamadas pelas RPCs (SECURITY INVOKER).
revoke all on function public.fase1_somar_meses(text, integer) from public, anon;
revoke all on function public.fase1_diferenca_meses(text, text) from public, anon;
revoke all on function public.fase1_nome_base(text) from public, anon;
revoke all on function public.fase1_recalcular_parcelamento(uuid) from public, anon;
revoke all on function public.criar_parcelamento(text, text, integer, text, numeric[]) from public, anon;
revoke all on function public.editar_parcela(uuid, text, text, numeric, text, integer) from public, anon;
revoke all on function public.excluir_parcela(uuid) from public, anon;
revoke all on function public.excluir_parcelamento(uuid) from public, anon;

grant execute on function public.fase1_somar_meses(text, integer) to authenticated;
grant execute on function public.fase1_diferenca_meses(text, text) to authenticated;
grant execute on function public.fase1_nome_base(text) to authenticated;
grant execute on function public.fase1_recalcular_parcelamento(uuid) to authenticated;
grant execute on function public.criar_parcelamento(text, text, integer, text, numeric[]) to authenticated;
grant execute on function public.editar_parcela(uuid, text, text, numeric, text, integer) to authenticated;
grant execute on function public.excluir_parcela(uuid) to authenticated;
grant execute on function public.excluir_parcelamento(uuid) to authenticated;

-- Função de trigger: não deve ser chamada diretamente por ninguém.
-- (o disparo do trigger não depende de EXECUTE do usuário)
revoke all on function public.fase1_parcelamentos_valor_contratado() from public, anon, authenticated;

-- =====================================================================
-- ROLLBACK (executar manualmente, se necessário, dentro de BEGIN/COMMIT)
-- =====================================================================
-- Atenção: remover as colunas apaga o histórico de pagamentos e o valor
-- contratado registrados a partir da FASE 1.
--
-- alter table public.transacoes
--   add constraint transacoes_parcelamento_id_fkey
--   foreign key (parcelamento_id) references public.parcelamentos (id) on delete cascade;
-- alter table public.transacoes drop constraint if exists transacoes_parcelamento_usuario_fkey;
-- alter table public.parcelamentos drop constraint if exists parcelamentos_id_usuario_key;
-- drop function if exists public.excluir_parcelamento(uuid);
-- drop function if exists public.excluir_parcela(uuid);
-- drop function if exists public.editar_parcela(uuid, text, text, numeric, text, integer);
-- drop function if exists public.criar_parcelamento(text, text, integer, text, numeric[]);
-- drop function if exists public.fase1_recalcular_parcelamento(uuid);
-- drop function if exists public.fase1_nome_base(text);
-- drop function if exists public.fase1_diferenca_meses(text, text);
-- drop function if exists public.fase1_somar_meses(text, integer);
-- drop trigger if exists fase1_parcelamentos_valor_contratado on public.parcelamentos;
-- drop function if exists public.fase1_parcelamentos_valor_contratado();
-- alter table public.parcelamentos drop constraint if exists parcelamentos_valor_contratado_check;
-- alter table public.parcelamentos drop column if exists valor_contratado;
-- drop index if exists public.transacoes_parcelamento_numero_idx;
-- alter table public.transacoes drop constraint if exists transacoes_pago_em_consistente_check;
-- alter table public.transacoes drop constraint if exists transacoes_status_pagamento_check;
-- alter table public.transacoes drop column if exists pago_em;
-- alter table public.transacoes drop column if exists status_pagamento;
