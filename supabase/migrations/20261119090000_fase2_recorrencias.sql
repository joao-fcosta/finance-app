-- =====================================================================
-- FASE 2 — Contas recorrentes
-- =====================================================================
--
-- MODELO
--
--   recorrencias      regra de repetição (nome, valor, categoria,
--                     frequência, início, fim opcional, status).
--   transacoes        cada ocorrência gerada é uma linha comum de
--                     transacoes, ligada por recorrencia_id e com
--                     data_vencimento. Assim o dashboard, o pagamento e
--                     a edição individual continuam funcionando sem
--                     caminhos especiais.
--
-- GERAÇÃO (idempotente)
--
--   A função gerar_ocorrencias(p_ate) é chamada pelo servidor sempre que
--   os dados do usuário são consultados. Ela cria as ocorrências que
--   faltam até p_ate, inclusive meses em que o usuário não abriu o app.
--
--   Garantias contra duplicidade:
--     1. índice único (recorrencia_id, data_vencimento);
--     2. marca d'água recorrencias.gerada_ate: datas já processadas não
--        são geradas de novo. Por isso, excluir uma ocorrência individual
--        não faz ela "voltar";
--     3. a recorrência é travada (FOR UPDATE) durante a geração, então
--        chamadas simultâneas não competem.
--
--   Datas: sempre calculadas a partir da data inicial (início + n
--   períodos), nunca acumuladas. Uma conta do dia 31 cai em 28/02 (ou
--   29/02) e volta para 31/03, sem "encolher".
--
-- HISTÓRICO
--
--   Editar uma recorrência altera apenas ocorrências FUTURAS e PENDENTES
--   que ainda não foram editadas individualmente. Ocorrências passadas ou
--   pagas nunca são alteradas. Excluir uma recorrência preserva as
--   ocorrências passadas como transações comuns (recorrencia_id = NULL).
--
-- Também nesta migration:
--   - cancelar_parcelas_futuras (parcelamentos): remove só as parcelas
--     pendentes de meses futuros, preservando pagas e o mês atual.
--   - índice (usuario_id, mes_referencia) para a consulta principal.
--
-- Aplicar via MCP (apply_migration) ou no SQL Editor entre BEGIN/COMMIT.
-- Todos os comandos são idempotentes. Nenhum dado existente é alterado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pré-requisitos (FASE 1 aplicada)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transacoes' and column_name = 'status_pagamento'
  ) then
    raise exception 'FASE 2: aplique antes a migration da FASE 1 (status_pagamento ausente).';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Tabela recorrencias
-- ---------------------------------------------------------------------
create table if not exists public.recorrencias (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null default auth.uid() references auth.users (id),
  nome          varchar(200) not null,
  tipo          varchar(10) not null,
  categoria_id  integer references public.categorias (id),
  valor         numeric(10,2) not null,
  frequencia    text not null,
  intervalo     smallint not null default 1,
  data_inicio   date not null,
  data_fim      date,
  status        text not null default 'ativa',
  gerada_ate    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint recorrencias_id_usuario_key unique (id, usuario_id),
  constraint recorrencias_nome_check check (length(btrim(nome)) between 1 and 200),
  constraint recorrencias_tipo_check check (tipo in ('receita', 'despesa')),
  constraint recorrencias_categoria_check check (tipo = 'despesa' or categoria_id is null),
  constraint recorrencias_valor_check check (valor > 0),
  constraint recorrencias_frequencia_check check (frequencia in ('semanal', 'mensal', 'anual')),
  constraint recorrencias_intervalo_check check (intervalo between 1 and 24),
  constraint recorrencias_periodo_check check (data_fim is null or data_fim >= data_inicio),
  constraint recorrencias_status_check check (status in ('ativa', 'pausada', 'encerrada'))
);

comment on table public.recorrencias is
  'Regras de contas recorrentes. As ocorrências ficam em transacoes (recorrencia_id).';
comment on column public.recorrencias.intervalo is
  'Repete a cada N períodos da frequência (ex.: mensal + 2 = a cada 2 meses).';
comment on column public.recorrencias.gerada_ate is
  'Marca d''água: datas até aqui já foram processadas e não são geradas novamente.';

create index if not exists recorrencias_usuario_status_idx
  on public.recorrencias (usuario_id, status);

-- RLS: cada usuário só enxerga e altera as próprias recorrências.
alter table public.recorrencias enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recorrencias' and policyname = 'recorrencias_select_proprias') then
    create policy recorrencias_select_proprias on public.recorrencias
      for select to authenticated using ((select auth.uid()) = usuario_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recorrencias' and policyname = 'recorrencias_insert_proprias') then
    create policy recorrencias_insert_proprias on public.recorrencias
      for insert to authenticated with check ((select auth.uid()) = usuario_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recorrencias' and policyname = 'recorrencias_update_proprias') then
    create policy recorrencias_update_proprias on public.recorrencias
      for update to authenticated
      using ((select auth.uid()) = usuario_id)
      with check ((select auth.uid()) = usuario_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recorrencias' and policyname = 'recorrencias_delete_proprias') then
    create policy recorrencias_delete_proprias on public.recorrencias
      for delete to authenticated using ((select auth.uid()) = usuario_id);
  end if;
end
$$;

-- Privilégios mínimos: anon não acessa; authenticated sem TRUNCATE.
revoke all on table public.recorrencias from anon, authenticated;
grant select, insert, update, delete on table public.recorrencias to authenticated;

-- ---------------------------------------------------------------------
-- 3. Ligação ocorrência ↔ recorrência em transacoes
-- ---------------------------------------------------------------------
alter table public.transacoes
  add column if not exists recorrencia_id uuid,
  add column if not exists data_vencimento date;

comment on column public.transacoes.recorrencia_id is
  'Recorrência que gerou esta ocorrência. NULL = transação avulsa (ou recorrência excluída).';
comment on column public.transacoes.data_vencimento is
  'Data de vencimento (ocorrências de recorrências). Opcional para transações avulsas.';

-- FK composta: a ocorrência pertence ao mesmo usuário da recorrência.
-- ON DELETE SET NULL (recorrencia_id): excluir a recorrência preserva o
-- histórico como transações comuns, sem tocar em usuario_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.transacoes'::regclass
       and conname = 'transacoes_recorrencia_usuario_fkey'
  ) then
    alter table public.transacoes
      add constraint transacoes_recorrencia_usuario_fkey
      foreign key (recorrencia_id, usuario_id)
      references public.recorrencias (id, usuario_id)
      on delete set null (recorrencia_id);
  end if;
end
$$;

-- Idempotência da geração: uma ocorrência por data e recorrência.
create unique index if not exists transacoes_recorrencia_data_key
  on public.transacoes (recorrencia_id, data_vencimento)
  where recorrencia_id is not null;

-- Consulta principal do app (transações do mês do usuário).
create index if not exists transacoes_usuario_mes_idx
  on public.transacoes (usuario_id, mes_referencia);

-- ---------------------------------------------------------------------
-- 4. Cálculo de datas
-- ---------------------------------------------------------------------

-- "Hoje" no fuso do usuário (Brasil). O servidor do banco usa UTC: sem
-- isso, depois das 21h uma conta seria tratada como do dia seguinte.
-- A configuração de sessão app.hoje permite fixar a data nos testes
-- automatizados (não pode ser definida pela API do Supabase).
create or replace function public.fase2_hoje()
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('app.hoje', true), '')::date,
    (now() at time zone 'America/Sao_Paulo')::date
  )
$$;

-- Data da n-ésima ocorrência (n >= 0), sempre a partir do início.
-- date + interval 'n months' ajusta para o último dia do mês quando
-- necessário (31/01 + 1 mês = 28/02; 31/01 + 2 meses = 31/03).
create or replace function public.fase2_data_ocorrencia(
  p_inicio date,
  p_frequencia text,
  p_intervalo integer,
  p_n integer
)
returns date
language sql
immutable
set search_path = public
as $$
  select case p_frequencia
    when 'semanal' then p_inicio + (7 * p_intervalo * p_n)
    when 'mensal'  then (p_inicio + make_interval(months => p_intervalo * p_n))::date
    when 'anual'   then (p_inicio + make_interval(years => p_intervalo * p_n))::date
  end
$$;

-- ---------------------------------------------------------------------
-- 5. Geração de ocorrências
-- ---------------------------------------------------------------------

-- Gera as ocorrências de UMA recorrência até p_ate. Uso interno.
create or replace function public.fase2_gerar_recorrencia(p_recorrencia_id uuid, p_ate date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.recorrencias%rowtype;
  v_de date;
  v_limite date;
  v_data date;
  v_n integer;
  v_qtd integer;
  v_inseridas integer := 0;
begin
  select * into r
    from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid
   for update;

  if not found or r.status <> 'ativa' then
    return 0;
  end if;

  v_de := greatest(r.data_inicio, coalesce(r.gerada_ate + 1, r.data_inicio));
  -- Teto de segurança: no máximo ~10 anos à frente.
  v_limite := least(p_ate, coalesce(r.data_fim, p_ate), public.fase2_hoje() + 3660);

  if v_limite < v_de then
    return 0;
  end if;

  -- Ponto de partida aproximado (evita iterar desde o início em
  -- recorrências antigas). O "- 1" garante que nenhuma data é pulada.
  v_n := greatest(0, (case r.frequencia
    when 'semanal' then (v_de - r.data_inicio) / (7 * r.intervalo)
    when 'mensal' then (
        (extract(year from v_de)::int * 12 + extract(month from v_de)::int)
      - (extract(year from r.data_inicio)::int * 12 + extract(month from r.data_inicio)::int)
    ) / r.intervalo
    else (extract(year from v_de)::int - extract(year from r.data_inicio)::int) / r.intervalo
  end) - 1);

  loop
    v_data := public.fase2_data_ocorrencia(r.data_inicio, r.frequencia, r.intervalo, v_n);
    exit when v_data > v_limite;

    if v_data >= v_de then
      insert into public.transacoes (
        usuario_id, nome, mes_referencia, valor_estimado, tipo, categoria_id,
        recorrencia_id, data_vencimento, status_pagamento
      ) values (
        v_uid, r.nome, to_char(v_data, 'YYYY-MM'), r.valor, r.tipo,
        case when r.tipo = 'despesa' then r.categoria_id else null end,
        r.id, v_data, 'pendente'
      )
      on conflict (recorrencia_id, data_vencimento) where recorrencia_id is not null
      do nothing;

      get diagnostics v_qtd = row_count;
      v_inseridas := v_inseridas + v_qtd;
    end if;

    v_n := v_n + 1;
    exit when v_n > 100000;
  end loop;

  update public.recorrencias
     set gerada_ate = v_limite
   where id = r.id and usuario_id = v_uid;

  return v_inseridas;
end
$$;

-- Gera as ocorrências pendentes de TODAS as recorrências ativas do
-- usuário até p_ate. Sem efeito (e sem escrita) quando já está em dia.
create or replace function public.gerar_ocorrencias(p_ate date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_total integer := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if p_ate is null then
    raise exception 'Informe a data limite.' using errcode = '22023';
  end if;

  for v_id in
    select id
      from public.recorrencias
     where usuario_id = v_uid
       and status = 'ativa'
       and data_inicio <= p_ate
       and (gerada_ate is null or gerada_ate < least(p_ate, coalesce(data_fim, p_ate)))
     order by id
  loop
    v_total := v_total + public.fase2_gerar_recorrencia(v_id, p_ate);
  end loop;

  return v_total;
end
$$;

-- ---------------------------------------------------------------------
-- 6. RPCs de gerenciamento
-- ---------------------------------------------------------------------

-- Cria a recorrência e já gera as ocorrências até p_gerar_ate.
create or replace function public.criar_recorrencia(
  p_nome text,
  p_tipo text,
  p_categoria_id integer,
  p_valor numeric,
  p_frequencia text,
  p_intervalo integer,
  p_data_inicio date,
  p_data_fim date,
  p_gerar_ate date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text := btrim(coalesce(p_nome, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if v_nome = '' or length(v_nome) > 200 then
    raise exception 'Informe um nome com até 200 caracteres.' using errcode = '22023';
  end if;

  if p_tipo not in ('receita', 'despesa') then
    raise exception 'Tipo de transação inválido.' using errcode = '22023';
  end if;

  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) or p_valor > 99999999.99 then
    raise exception 'Informe um valor válido.' using errcode = '22023';
  end if;

  if p_frequencia not in ('semanal', 'mensal', 'anual') then
    raise exception 'Frequência inválida.' using errcode = '22023';
  end if;

  if p_intervalo is null or p_intervalo < 1 or p_intervalo > 24 then
    raise exception 'O intervalo deve ser entre 1 e 24.' using errcode = '22023';
  end if;

  if p_data_inicio is null then
    raise exception 'Informe a data da primeira ocorrência.' using errcode = '22023';
  end if;

  if p_data_fim is not null and p_data_fim < p_data_inicio then
    raise exception 'A data final deve ser igual ou posterior à data inicial.' using errcode = '22023';
  end if;

  insert into public.recorrencias (
    usuario_id, nome, tipo, categoria_id, valor, frequencia, intervalo, data_inicio, data_fim
  ) values (
    v_uid, v_nome, p_tipo,
    case when p_tipo = 'despesa' then p_categoria_id else null end,
    p_valor, p_frequencia, p_intervalo, p_data_inicio, p_data_fim
  )
  returning id into v_id;

  perform public.fase2_gerar_recorrencia(v_id, coalesce(p_gerar_ate, public.fase2_hoje()));

  return v_id;
end
$$;

-- Edita nome, valor, categoria e data final.
-- Ocorrências futuras pendentes recebem os novos valores somente nos
-- campos que ainda estão iguais aos valores antigos da recorrência
-- (ou seja, campos editados individualmente são preservados).
-- Ocorrências passadas e pagas nunca mudam.
-- Retorna a quantidade de ocorrências atualizadas.
create or replace function public.editar_recorrencia(
  p_recorrencia_id uuid,
  p_nome text,
  p_valor numeric,
  p_categoria_id integer,
  p_data_fim date
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.recorrencias%rowtype;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_categoria integer;
  v_afetadas integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into r
    from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;

  if v_nome = '' or length(v_nome) > 200 then
    raise exception 'Informe um nome com até 200 caracteres.' using errcode = '22023';
  end if;

  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) or p_valor > 99999999.99 then
    raise exception 'Informe um valor válido.' using errcode = '22023';
  end if;

  if p_data_fim is not null and p_data_fim < r.data_inicio then
    raise exception 'A data final deve ser igual ou posterior à data inicial.' using errcode = '22023';
  end if;

  v_categoria := case when r.tipo = 'despesa' then p_categoria_id else null end;

  update public.transacoes t
     set nome = case when t.nome = r.nome then v_nome else t.nome end,
         valor_estimado = case when t.valor_estimado = r.valor then p_valor else t.valor_estimado end,
         categoria_id = case when t.categoria_id is not distinct from r.categoria_id then v_categoria else t.categoria_id end
   where t.recorrencia_id = r.id
     and t.usuario_id = v_uid
     and t.data_vencimento >= public.fase2_hoje()
     and t.status_pagamento is distinct from 'pago';

  get diagnostics v_afetadas = row_count;

  -- Nova data final mais cedo: remove ocorrências pendentes além dela.
  if p_data_fim is not null then
    delete from public.transacoes
     where recorrencia_id = r.id
       and usuario_id = v_uid
       and data_vencimento > p_data_fim
       and status_pagamento is distinct from 'pago';
  end if;

  update public.recorrencias
     set nome = v_nome,
         valor = p_valor,
         categoria_id = v_categoria,
         data_fim = p_data_fim,
         gerada_ate = case
           when p_data_fim is not null and gerada_ate > p_data_fim then p_data_fim
           else gerada_ate
         end,
         updated_at = now()
   where id = r.id and usuario_id = v_uid;

  return v_afetadas;
end
$$;

-- Pausa: gera o que já venceu até hoje, remove ocorrências futuras
-- pendentes e para de gerar. O período pausado não é gerado depois.
create or replace function public.pausar_recorrencia(p_recorrencia_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.recorrencias%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into r from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;

  if r.status <> 'ativa' then
    raise exception 'Somente recorrências ativas podem ser pausadas.' using errcode = '22023';
  end if;

  perform public.fase2_gerar_recorrencia(r.id, public.fase2_hoje());

  delete from public.transacoes
   where recorrencia_id = r.id
     and usuario_id = v_uid
     and data_vencimento > public.fase2_hoje()
     and status_pagamento is distinct from 'pago';

  -- As ocorrências futuras foram removidas: a marca d'água volta para
  -- hoje, para que a reativação gere o que vier depois dela.
  update public.recorrencias
     set status = 'pausada',
         gerada_ate = least(public.fase2_hoje(), coalesce(data_fim, public.fase2_hoje())),
         updated_at = now()
   where id = r.id and usuario_id = v_uid;
end
$$;

-- Reativa: volta a gerar a partir de hoje (o período pausado é pulado).
create or replace function public.reativar_recorrencia(p_recorrencia_id uuid, p_gerar_ate date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.recorrencias%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into r from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;

  if r.status <> 'pausada' then
    raise exception 'Somente recorrências pausadas podem ser reativadas.' using errcode = '22023';
  end if;

  update public.recorrencias
     set status = 'ativa',
         gerada_ate = greatest(coalesce(gerada_ate, r.data_inicio - 1), public.fase2_hoje() - 1),
         updated_at = now()
   where id = r.id and usuario_id = v_uid;

  return public.fase2_gerar_recorrencia(r.id, coalesce(p_gerar_ate, public.fase2_hoje()));
end
$$;

-- Encerra: gera o que já venceu até hoje, remove ocorrências futuras
-- pendentes e define a data final. O histórico é preservado.
create or replace function public.encerrar_recorrencia(p_recorrencia_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.recorrencias%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into r from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;

  if r.status = 'encerrada' then
    raise exception 'Esta recorrência já está encerrada.' using errcode = '22023';
  end if;

  if r.status = 'ativa' then
    perform public.fase2_gerar_recorrencia(r.id, public.fase2_hoje());
  end if;

  delete from public.transacoes
   where recorrencia_id = r.id
     and usuario_id = v_uid
     and data_vencimento > public.fase2_hoje()
     and status_pagamento is distinct from 'pago';

  update public.recorrencias
     set status = 'encerrada',
         data_fim = greatest(r.data_inicio, least(coalesce(r.data_fim, public.fase2_hoje()), public.fase2_hoje())),
         updated_at = now()
   where id = r.id and usuario_id = v_uid;
end
$$;

-- Exclui a regra. Ocorrências futuras pendentes são removidas; as
-- demais (passadas ou pagas) permanecem como transações comuns.
-- Retorna a quantidade de ocorrências removidas.
create or replace function public.excluir_recorrencia(p_recorrencia_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_removidas integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  perform 1 from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid
   for update;

  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;

  delete from public.transacoes
   where recorrencia_id = p_recorrencia_id
     and usuario_id = v_uid
     and data_vencimento > public.fase2_hoje()
     and status_pagamento is distinct from 'pago';

  get diagnostics v_removidas = row_count;

  delete from public.recorrencias
   where id = p_recorrencia_id and usuario_id = v_uid;

  return v_removidas;
end
$$;

-- ---------------------------------------------------------------------
-- 7. Parcelamentos: cancelar somente parcelas futuras
-- ---------------------------------------------------------------------
-- Remove parcelas PENDENTES de meses posteriores ao mês atual. Parcelas
-- pagas, do mês atual e anteriores são preservadas. valor_contratado
-- não muda; valor_total e total_parcelas refletem o que restou.
-- Retorna a quantidade de parcelas canceladas.
create or replace function public.cancelar_parcelas_futuras(p_parcelamento_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mes_atual text := to_char(public.fase2_hoje(), 'YYYY-MM');
  v_total integer;
  v_canceladas integer;
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

  select count(*) into v_total
    from public.transacoes
   where parcelamento_id = p_parcelamento_id and usuario_id = v_uid;

  select count(*) into v_canceladas
    from public.transacoes
   where parcelamento_id = p_parcelamento_id
     and usuario_id = v_uid
     and mes_referencia > v_mes_atual
     and status_pagamento is distinct from 'pago';

  if v_canceladas = 0 then
    raise exception 'Não há parcelas futuras pendentes para cancelar.' using errcode = '22023';
  end if;

  if v_canceladas = v_total then
    raise exception 'Todas as parcelas são futuras. Exclua o parcelamento inteiro.' using errcode = '22023';
  end if;

  delete from public.transacoes
   where parcelamento_id = p_parcelamento_id
     and usuario_id = v_uid
     and mes_referencia > v_mes_atual
     and status_pagamento is distinct from 'pago';

  update public.parcelamentos
     set total_parcelas = v_total - v_canceladas
   where id = p_parcelamento_id and usuario_id = v_uid;

  perform public.fase1_recalcular_parcelamento(p_parcelamento_id);

  return v_canceladas;
end
$$;

-- ---------------------------------------------------------------------
-- 8. Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public.fase2_data_ocorrencia(date, text, integer, integer) from public, anon;
revoke all on function public.fase2_gerar_recorrencia(uuid, date) from public, anon;
revoke all on function public.gerar_ocorrencias(date) from public, anon;
revoke all on function public.criar_recorrencia(text, text, integer, numeric, text, integer, date, date, date) from public, anon;
revoke all on function public.editar_recorrencia(uuid, text, numeric, integer, date) from public, anon;
revoke all on function public.pausar_recorrencia(uuid) from public, anon;
revoke all on function public.reativar_recorrencia(uuid, date) from public, anon;
revoke all on function public.encerrar_recorrencia(uuid) from public, anon;
revoke all on function public.excluir_recorrencia(uuid) from public, anon;
revoke all on function public.cancelar_parcelas_futuras(uuid) from public, anon;

grant execute on function public.fase2_data_ocorrencia(date, text, integer, integer) to authenticated;
grant execute on function public.fase2_gerar_recorrencia(uuid, date) to authenticated;
grant execute on function public.gerar_ocorrencias(date) to authenticated;
grant execute on function public.criar_recorrencia(text, text, integer, numeric, text, integer, date, date, date) to authenticated;
grant execute on function public.editar_recorrencia(uuid, text, numeric, integer, date) to authenticated;
grant execute on function public.pausar_recorrencia(uuid) to authenticated;
grant execute on function public.reativar_recorrencia(uuid, date) to authenticated;
grant execute on function public.encerrar_recorrencia(uuid) to authenticated;
grant execute on function public.excluir_recorrencia(uuid) to authenticated;
grant execute on function public.cancelar_parcelas_futuras(uuid) to authenticated;

revoke all on function public.fase2_hoje() from public, anon;
grant execute on function public.fase2_hoje() to authenticated;
