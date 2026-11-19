-- =====================================================================
-- FASE 3 — Cartões de crédito e faturas
-- =====================================================================
--
-- MODELO
--
--   cartoes             cartão do usuário (limite, dia de fechamento e
--                       de vencimento, ativo/inativo).
--   faturas             uma por cartão e mês de referência (= mês do
--                       VENCIMENTO). Guarda as datas de fechamento e de
--                       vencimento daquele ciclo. Total e status NÃO são
--                       gravados: são derivados das compras e pagamentos,
--                       então nunca ficam desatualizados.
--   pagamentos_fatura   pagamentos (totais ou parciais) de uma fatura.
--   transacoes          compras no crédito continuam sendo despesas em
--                       transacoes (forma_pagamento = 'credito'), ligadas
--                       ao cartão e à fatura. O mes_referencia da compra
--                       é o mês da fatura (quando o dinheiro sai).
--
-- REGRAS FINANCEIRAS
--
--   1. A compra no cartão é a despesa de consumo.
--   2. O pagamento da fatura NÃO é despesa: fica em pagamentos_fatura e
--      não entra em transacoes. Assim não há contagem duplicada.
--   3. Ciclo: compra ANTES do dia de fechamento entra na fatura que fecha
--      naquele mês; no dia do fechamento ou depois, entra na seguinte.
--      Vencimento no mesmo mês do fechamento se o dia de vencimento for
--      maior que o de fechamento; senão, no mês seguinte. Dias inexistentes
--      (ex.: 31 em fevereiro) usam o último dia do mês.
--   4. Compra parcelada: parcela i vai para a fatura i-1 ciclos depois.
--      Valores distribuídos em centavos pela aplicação (soma exata).
--   5. Limite utilizado = compras no cartão − pagamentos (calculado).
--
-- Também nesta migration:
--   - transacoes.forma_pagamento (dinheiro | pix | debito | credito).
--   - recorrências no cartão (ex.: assinatura): cada ocorrência entra na
--     fatura correspondente à data da cobrança.
--   - editar_parcela passa a impedir mudar o mês de parcelas no cartão
--     (a fatura é determinada pela data da compra).
--
-- Aplicar via MCP (apply_migration) ou no SQL Editor entre BEGIN/COMMIT.
-- Idempotente. Nenhum dado existente é alterado.
-- =====================================================================

do $$
begin
  if to_regclass('public.recorrencias') is null then
    raise exception 'FASE 3: aplique antes a migration da FASE 2 (recorrencias ausente).';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.cartoes (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null default auth.uid() references auth.users (id),
  nome            varchar(60) not null,
  bandeira        varchar(30),
  limite          numeric(10,2) not null default 0,
  dia_fechamento  smallint not null,
  dia_vencimento  smallint not null,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint cartoes_id_usuario_key unique (id, usuario_id),
  constraint cartoes_nome_check check (length(btrim(nome)) between 1 and 60),
  constraint cartoes_limite_check check (limite >= 0),
  constraint cartoes_dia_fechamento_check check (dia_fechamento between 1 and 31),
  constraint cartoes_dia_vencimento_check check (dia_vencimento between 1 and 31)
);

create table if not exists public.faturas (
  id               uuid primary key default gen_random_uuid(),
  usuario_id       uuid not null default auth.uid() references auth.users (id),
  cartao_id        uuid not null,
  mes_referencia   varchar(7) not null,
  data_fechamento  date not null,
  data_vencimento  date not null,
  created_at       timestamptz not null default now(),

  constraint faturas_id_usuario_key unique (id, usuario_id),
  constraint faturas_cartao_mes_key unique (cartao_id, mes_referencia),
  constraint faturas_mes_check check (mes_referencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint faturas_datas_check check (data_vencimento > data_fechamento),
  constraint faturas_cartao_usuario_fkey foreign key (cartao_id, usuario_id)
    references public.cartoes (id, usuario_id) on delete cascade
);

create table if not exists public.pagamentos_fatura (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null default auth.uid() references auth.users (id),
  fatura_id       uuid not null,
  valor           numeric(10,2) not null,
  data_pagamento  date not null,
  created_at      timestamptz not null default now(),

  constraint pagamentos_fatura_valor_check check (valor > 0),
  constraint pagamentos_fatura_fatura_usuario_fkey foreign key (fatura_id, usuario_id)
    references public.faturas (id, usuario_id) on delete cascade
);

comment on table public.faturas is
  'Ciclo de fatura por cartão e mês do vencimento. Total e status são derivados (compras e pagamentos).';
comment on table public.pagamentos_fatura is
  'Liquidação da fatura. NÃO é despesa: as compras já são as despesas.';

create index if not exists cartoes_usuario_idx on public.cartoes (usuario_id);
create index if not exists faturas_usuario_mes_idx on public.faturas (usuario_id, mes_referencia);
create index if not exists pagamentos_fatura_fatura_idx on public.pagamentos_fatura (fatura_id);

-- RLS e privilégios mínimos nas três tabelas.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['cartoes', 'faturas', 'pagamentos_fatura'] loop
    execute format('alter table public.%I enable row level security', t);

    foreach op in array array['select', 'insert', 'update', 'delete'] loop
      if not exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = t and policyname = t || '_' || op || '_proprios'
      ) then
        execute format(
          'create policy %I on public.%I for %s to authenticated %s',
          t || '_' || op || '_proprios', t, op,
          case op
            when 'insert' then 'with check ((select auth.uid()) = usuario_id)'
            when 'update' then 'using ((select auth.uid()) = usuario_id) with check ((select auth.uid()) = usuario_id)'
            else 'using ((select auth.uid()) = usuario_id)'
          end
        );
      end if;
    end loop;

    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Novas colunas em transacoes e recorrencias
-- ---------------------------------------------------------------------
alter table public.transacoes
  add column if not exists forma_pagamento text,
  add column if not exists cartao_id uuid,
  add column if not exists fatura_id uuid,
  add column if not exists data_compra date;

alter table public.recorrencias
  add column if not exists forma_pagamento text,
  add column if not exists cartao_id uuid;

comment on column public.transacoes.forma_pagamento is
  'dinheiro | pix | debito | credito. NULL = não informado (registros antigos).';
comment on column public.transacoes.fatura_id is
  'Fatura da compra no crédito. O mes_referencia da transação é o mês da fatura.';

do $$
begin
  -- forma de pagamento válida
  if not exists (select 1 from pg_constraint where conname = 'transacoes_forma_pagamento_check') then
    alter table public.transacoes add constraint transacoes_forma_pagamento_check
      check (forma_pagamento is null or forma_pagamento in ('dinheiro', 'pix', 'debito', 'credito'));
  end if;

  -- crédito exige cartão e fatura (e só despesas); demais formas não têm
  if not exists (select 1 from pg_constraint where conname = 'transacoes_credito_check') then
    alter table public.transacoes add constraint transacoes_credito_check
      check (
        (forma_pagamento = 'credito' and tipo = 'despesa' and cartao_id is not null and fatura_id is not null)
        or (forma_pagamento is distinct from 'credito' and cartao_id is null and fatura_id is null)
      );
  end if;

  -- cartão e fatura pertencem ao mesmo usuário da transação.
  -- Sem cascade: um cartão com compras não pode ser apagado (desative-o).
  if not exists (select 1 from pg_constraint where conname = 'transacoes_cartao_usuario_fkey') then
    alter table public.transacoes add constraint transacoes_cartao_usuario_fkey
      foreign key (cartao_id, usuario_id) references public.cartoes (id, usuario_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'transacoes_fatura_usuario_fkey') then
    alter table public.transacoes add constraint transacoes_fatura_usuario_fkey
      foreign key (fatura_id, usuario_id) references public.faturas (id, usuario_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'recorrencias_forma_pagamento_check') then
    alter table public.recorrencias add constraint recorrencias_forma_pagamento_check
      check (
        (forma_pagamento is null or forma_pagamento in ('dinheiro', 'pix', 'debito', 'credito'))
        and ((forma_pagamento is not distinct from 'credito') = (cartao_id is not null))
        and (cartao_id is null or tipo = 'despesa')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'recorrencias_cartao_usuario_fkey') then
    alter table public.recorrencias add constraint recorrencias_cartao_usuario_fkey
      foreign key (cartao_id, usuario_id) references public.cartoes (id, usuario_id);
  end if;
end
$$;

create index if not exists transacoes_fatura_idx on public.transacoes (fatura_id) where fatura_id is not null;
create index if not exists transacoes_cartao_idx on public.transacoes (cartao_id) where cartao_id is not null;

-- ---------------------------------------------------------------------
-- 3. Ciclo da fatura
-- ---------------------------------------------------------------------

-- Data no mês de índice p_indice (ano*12 + mês-1), limitando o dia ao
-- último dia do mês.
create or replace function public.fase3_dia_no_mes(p_indice integer, p_dia integer)
returns date
language sql
immutable
set search_path = public
as $$
  select make_date(
    p_indice / 12,
    p_indice % 12 + 1,
    least(
      p_dia,
      extract(day from (make_date(p_indice / 12, p_indice % 12 + 1, 1) + interval '1 month' - interval '1 day'))::int
    )
  )
$$;

-- Fatura de uma compra feita em p_data, deslocada p_deslocamento ciclos
-- (parcela i de uma compra parcelada usa deslocamento i-1).
create or replace function public.fase3_ciclo_fatura(
  p_dia_fechamento integer,
  p_dia_vencimento integer,
  p_data date,
  p_deslocamento integer,
  out mes_referencia text,
  out data_fechamento date,
  out data_vencimento date
)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_indice_compra integer := extract(year from p_data)::int * 12 + extract(month from p_data)::int - 1;
  v_indice_fechamento integer;
  v_indice_vencimento integer;
begin
  v_indice_fechamento := v_indice_compra
    + case when p_data >= public.fase3_dia_no_mes(v_indice_compra, p_dia_fechamento) then 1 else 0 end
    + p_deslocamento;

  v_indice_vencimento := v_indice_fechamento
    + case when p_dia_vencimento > p_dia_fechamento then 0 else 1 end;

  data_fechamento := public.fase3_dia_no_mes(v_indice_fechamento, p_dia_fechamento);
  data_vencimento := public.fase3_dia_no_mes(v_indice_vencimento, p_dia_vencimento);
  mes_referencia := to_char(data_vencimento, 'YYYY-MM');
end
$$;

-- Garante a fatura do cartão para o ciclo (cria se não existir) e
-- retorna o id. Concorrência: a unicidade (cartao_id, mes_referencia)
-- resolve criações simultâneas.
create or replace function public.fase3_garantir_fatura(
  p_cartao_id uuid,
  p_mes_referencia text,
  p_data_fechamento date,
  p_data_vencimento date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  insert into public.faturas (usuario_id, cartao_id, mes_referencia, data_fechamento, data_vencimento)
  values (v_uid, p_cartao_id, p_mes_referencia, p_data_fechamento, p_data_vencimento)
  on conflict (cartao_id, mes_referencia) do nothing;

  select id into v_id
    from public.faturas
   where cartao_id = p_cartao_id and mes_referencia = p_mes_referencia and usuario_id = v_uid;

  if v_id is null then
    raise exception 'Fatura não encontrada.' using errcode = 'P0002';
  end if;

  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- 4. RPC: registrar_compra_cartao
-- ---------------------------------------------------------------------
-- Uma parcela  → uma transação na fatura da data da compra.
-- N parcelas   → um parcelamento com N transações, uma por fatura.
-- Retorna o id da transação (1 parcela) ou do parcelamento (N parcelas).
create or replace function public.registrar_compra_cartao(
  p_cartao_id uuid,
  p_nome text,
  p_categoria_id integer,
  p_data_compra date,
  p_valores numeric[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.cartoes%rowtype;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_qtd integer := coalesce(array_length(p_valores, 1), 0);
  v_total numeric := 0;
  v_valor numeric;
  v_ciclo record;
  v_fatura uuid;
  v_parcelamento uuid;
  v_id uuid;
  i integer;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into c from public.cartoes where id = p_cartao_id and usuario_id = v_uid;
  if not found then
    raise exception 'Cartão não encontrado.' using errcode = 'P0002';
  end if;
  if not c.ativo then
    raise exception 'Este cartão está inativo. Reative-o para registrar compras.' using errcode = '22023';
  end if;

  if v_nome = '' or length(v_nome) > 200 then
    raise exception 'Informe um nome com até 200 caracteres.' using errcode = '22023';
  end if;

  if p_data_compra is null then
    raise exception 'Informe a data da compra.' using errcode = '22023';
  end if;

  if v_qtd < 1 or v_qtd > 420 then
    raise exception 'Quantidade de parcelas inválida.' using errcode = '22023';
  end if;

  foreach v_valor in array p_valores loop
    if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
      raise exception 'Valor de parcela inválido: %', v_valor using errcode = '22023';
    end if;
    v_total := v_total + v_valor;
  end loop;

  if v_total > 99999999.99 then
    raise exception 'O valor total excede o limite de R$ 99.999.999,99.' using errcode = '22023';
  end if;

  if v_qtd > 1 then
    insert into public.parcelamentos (usuario_id, nome, total_parcelas, valor_total, valor_contratado)
    values (v_uid, v_nome, v_qtd, v_total, v_total)
    returning id into v_parcelamento;
  end if;

  for i in 1..v_qtd loop
    select * into v_ciclo from public.fase3_ciclo_fatura(c.dia_fechamento, c.dia_vencimento, p_data_compra, i - 1);
    v_fatura := public.fase3_garantir_fatura(c.id, v_ciclo.mes_referencia, v_ciclo.data_fechamento, v_ciclo.data_vencimento);

    insert into public.transacoes (
      usuario_id, nome, mes_referencia, valor_estimado, tipo, categoria_id,
      parcelamento_id, numero_parcela, status_pagamento,
      forma_pagamento, cartao_id, fatura_id, data_compra
    ) values (
      v_uid,
      case when v_qtd > 1 then v_nome || ' (' || i || '/' || v_qtd || ')' else v_nome end,
      v_ciclo.mes_referencia, p_valores[i], 'despesa', p_categoria_id,
      v_parcelamento, case when v_qtd > 1 then i else null end, 'pendente',
      'credito', c.id, v_fatura, p_data_compra
    )
    returning id into v_id;
  end loop;

  return coalesce(v_parcelamento, v_id);
end
$$;

-- ---------------------------------------------------------------------
-- 5. RPCs de cartão e pagamento
-- ---------------------------------------------------------------------

-- Atualiza o cartão. Se os dias de fechamento/vencimento mudarem, as
-- faturas que ainda não fecharam passam a usar as novas datas (as
-- compras continuam nas mesmas faturas). Faturas fechadas não mudam.
create or replace function public.editar_cartao(
  p_cartao_id uuid,
  p_nome text,
  p_bandeira text,
  p_limite numeric,
  p_dia_fechamento integer,
  p_dia_vencimento integer,
  p_ativo boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.cartoes%rowtype;
  v_nome text := btrim(coalesce(p_nome, ''));
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select * into c from public.cartoes where id = p_cartao_id and usuario_id = v_uid for update;
  if not found then
    raise exception 'Cartão não encontrado.' using errcode = 'P0002';
  end if;

  if v_nome = '' or length(v_nome) > 60 then
    raise exception 'Informe um nome com até 60 caracteres.' using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 0 or p_limite <> round(p_limite, 2) or p_limite > 99999999.99 then
    raise exception 'Informe um limite válido.' using errcode = '22023';
  end if;
  if p_dia_fechamento not between 1 and 31 or p_dia_vencimento not between 1 and 31 then
    raise exception 'Os dias de fechamento e vencimento devem ser entre 1 e 31.' using errcode = '22023';
  end if;

  update public.cartoes
     set nome = v_nome,
         bandeira = nullif(btrim(coalesce(p_bandeira, '')), ''),
         limite = p_limite,
         dia_fechamento = p_dia_fechamento,
         dia_vencimento = p_dia_vencimento,
         ativo = coalesce(p_ativo, ativo),
         updated_at = now()
   where id = c.id and usuario_id = v_uid;

  if c.dia_fechamento <> p_dia_fechamento or c.dia_vencimento <> p_dia_vencimento then
    update public.faturas f
       set data_vencimento = public.fase3_dia_no_mes(x.indice_vencimento, p_dia_vencimento),
           data_fechamento = public.fase3_dia_no_mes(
             x.indice_vencimento - case when p_dia_vencimento > p_dia_fechamento then 0 else 1 end,
             p_dia_fechamento)
      from (
        select id,
               split_part(mes_referencia, '-', 1)::int * 12 + split_part(mes_referencia, '-', 2)::int - 1 as indice_vencimento
          from public.faturas
         where cartao_id = c.id and usuario_id = v_uid and data_fechamento > public.fase2_hoje()
      ) x
     where f.id = x.id and f.usuario_id = v_uid;
  end if;
end
$$;

-- Registra pagamento (total ou parcial). Não cria transação: o pagamento
-- liquida a fatura, as compras já são as despesas.
create or replace function public.pagar_fatura(p_fatura_id uuid, p_valor numeric, p_data date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_total numeric;
  v_pago numeric;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  perform 1 from public.faturas where id = p_fatura_id and usuario_id = v_uid for update;
  if not found then
    raise exception 'Fatura não encontrada.' using errcode = 'P0002';
  end if;

  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) then
    raise exception 'Informe um valor de pagamento válido.' using errcode = '22023';
  end if;

  select coalesce(sum(coalesce(valor_real, valor_estimado)), 0) into v_total
    from public.transacoes where fatura_id = p_fatura_id and usuario_id = v_uid;
  select coalesce(sum(valor), 0) into v_pago
    from public.pagamentos_fatura where fatura_id = p_fatura_id and usuario_id = v_uid;

  if v_total - v_pago <= 0 then
    raise exception 'Esta fatura já está paga.' using errcode = '22023';
  end if;

  if p_valor > v_total - v_pago then
    raise exception 'O valor excede o saldo da fatura (R$ %).', to_char(v_total - v_pago, 'FM999G999G990D00')
      using errcode = '22023';
  end if;

  insert into public.pagamentos_fatura (usuario_id, fatura_id, valor, data_pagamento)
  values (v_uid, p_fatura_id, p_valor, coalesce(p_data, public.fase2_hoje()))
  returning id into v_id;

  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Recorrências no cartão
-- ---------------------------------------------------------------------

-- Nova versão da criação de recorrência com forma de pagamento e cartão.
-- (criar_recorrencia da FASE 2 continua existindo e funcionando.)
create or replace function public.criar_recorrencia_v2(
  p_nome text,
  p_tipo text,
  p_categoria_id integer,
  p_valor numeric,
  p_frequencia text,
  p_intervalo integer,
  p_data_inicio date,
  p_data_fim date,
  p_gerar_ate date,
  p_forma_pagamento text,
  p_cartao_id uuid
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
  if p_forma_pagamento is not null and p_forma_pagamento not in ('dinheiro', 'pix', 'debito', 'credito') then
    raise exception 'Forma de pagamento inválida.' using errcode = '22023';
  end if;

  if p_forma_pagamento = 'credito' then
    if p_tipo <> 'despesa' then
      raise exception 'Somente despesas podem ser no cartão de crédito.' using errcode = '22023';
    end if;
    perform 1 from public.cartoes where id = p_cartao_id and usuario_id = v_uid and ativo;
    if not found then
      raise exception 'Escolha um cartão ativo.' using errcode = '22023';
    end if;
  end if;

  insert into public.recorrencias (
    usuario_id, nome, tipo, categoria_id, valor, frequencia, intervalo,
    data_inicio, data_fim, forma_pagamento, cartao_id
  ) values (
    v_uid, v_nome, p_tipo,
    case when p_tipo = 'despesa' then p_categoria_id else null end,
    p_valor, p_frequencia, p_intervalo, p_data_inicio, p_data_fim,
    case when p_tipo = 'despesa' then p_forma_pagamento else null end,
    case when p_forma_pagamento = 'credito' then p_cartao_id else null end
  )
  returning id into v_id;

  perform public.fase2_gerar_recorrencia(v_id, coalesce(p_gerar_ate, public.fase2_hoje()));

  return v_id;
end
$$;

-- Gerador (mesma assinatura da FASE 2), agora ciente do cartão: a
-- ocorrência de uma recorrência no crédito entra na fatura da data da
-- cobrança, com mes_referencia = mês da fatura.
create or replace function public.fase2_gerar_recorrencia(p_recorrencia_id uuid, p_ate date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.recorrencias%rowtype;
  c public.cartoes%rowtype;
  v_ciclo record;
  v_fatura uuid;
  v_mes text;
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

  if r.cartao_id is not null then
    select * into c from public.cartoes where id = r.cartao_id and usuario_id = v_uid;
  end if;

  v_de := greatest(r.data_inicio, coalesce(r.gerada_ate + 1, r.data_inicio));
  v_limite := least(p_ate, coalesce(r.data_fim, p_ate), public.fase2_hoje() + 3660);

  if v_limite < v_de then
    return 0;
  end if;

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
      v_fatura := null;
      v_mes := to_char(v_data, 'YYYY-MM');

      if c.id is not null then
        select * into v_ciclo from public.fase3_ciclo_fatura(c.dia_fechamento, c.dia_vencimento, v_data, 0);
        v_fatura := public.fase3_garantir_fatura(c.id, v_ciclo.mes_referencia, v_ciclo.data_fechamento, v_ciclo.data_vencimento);
        v_mes := v_ciclo.mes_referencia;
      end if;

      insert into public.transacoes (
        usuario_id, nome, mes_referencia, valor_estimado, tipo, categoria_id,
        recorrencia_id, data_vencimento, status_pagamento,
        forma_pagamento, cartao_id, fatura_id, data_compra
      ) values (
        v_uid, r.nome, v_mes, r.valor, r.tipo,
        case when r.tipo = 'despesa' then r.categoria_id else null end,
        r.id, v_data, 'pendente',
        r.forma_pagamento, c.id, v_fatura,
        case when c.id is not null then v_data else null end
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

-- ---------------------------------------------------------------------
-- 7. editar_parcela: parcela no cartão não muda de mês
-- ---------------------------------------------------------------------
-- Mesma função da FASE 1, com uma regra a mais: o mês de uma parcela no
-- cartão é o mês da fatura, definido pela data da compra.
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

  if v_parcela.fatura_id is not null and p_mes <> v_parcela.mes_referencia then
    raise exception 'Parcelas no cartão ficam na fatura definida pela data da compra; o mês não pode ser alterado.'
      using errcode = '22023';
  end if;

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
-- 8. Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public.fase3_dia_no_mes(integer, integer) from public, anon;
revoke all on function public.fase3_ciclo_fatura(integer, integer, date, integer) from public, anon;
revoke all on function public.fase3_garantir_fatura(uuid, text, date, date) from public, anon;
revoke all on function public.registrar_compra_cartao(uuid, text, integer, date, numeric[]) from public, anon;
revoke all on function public.editar_cartao(uuid, text, text, numeric, integer, integer, boolean) from public, anon;
revoke all on function public.pagar_fatura(uuid, numeric, date) from public, anon;
revoke all on function public.criar_recorrencia_v2(text, text, integer, numeric, text, integer, date, date, date, text, uuid) from public, anon;
revoke all on function public.fase2_gerar_recorrencia(uuid, date) from public, anon;
revoke all on function public.editar_parcela(uuid, text, text, numeric, text, integer) from public, anon;

grant execute on function public.fase3_dia_no_mes(integer, integer) to authenticated;
grant execute on function public.fase3_ciclo_fatura(integer, integer, date, integer) to authenticated;
grant execute on function public.fase3_garantir_fatura(uuid, text, date, date) to authenticated;
grant execute on function public.registrar_compra_cartao(uuid, text, integer, date, numeric[]) to authenticated;
grant execute on function public.editar_cartao(uuid, text, text, numeric, integer, integer, boolean) to authenticated;
grant execute on function public.pagar_fatura(uuid, numeric, date) to authenticated;
grant execute on function public.criar_recorrencia_v2(text, text, integer, numeric, text, integer, date, date, date, text, uuid) to authenticated;
grant execute on function public.fase2_gerar_recorrencia(uuid, date) to authenticated;
grant execute on function public.editar_parcela(uuid, text, text, numeric, text, integer) to authenticated;
