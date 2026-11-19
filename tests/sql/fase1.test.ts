import { beforeAll, describe, expect, it } from 'vitest'
import { Banco, USUARIO_A as A, USUARIO_B as B, aplicar, criarBanco, lerMigration, listarMigrations } from './banco'

const PA = '5bdaf446-7486-4879-a8e7-0d7ec33bd5bc'
const PB = 'ed7c1447-487e-4fe7-9276-0284c7fb8143'

// Dados equivalentes aos reais no momento da FASE 1 (valores, não nomes).
const DADOS_LEGADOS = `
  insert into parcelamentos (id, usuario_id, nome, total_parcelas, valor_total) values
    ('${PA}', '${A}', 'Compra A', 2, 736.00),
    ('${PB}', '${A}', 'Compra B', 2, 548.46);
  insert into transacoes (usuario_id, nome, mes_referencia, valor_estimado, tipo, categoria_id, parcelamento_id, numero_parcela) values
    ('${A}', 'Compra A (1/2)', '2026-12', 368, 'despesa', 2, '${PA}', 1),
    ('${A}', 'Compra A (2/2)', '2027-01', 368, 'despesa', 2, '${PA}', 2),
    ('${A}', 'Compra B (1/2)', '2026-10', 274.23, 'despesa', 1, '${PB}', 1),
    ('${A}', 'Compra B (2/2)', '2026-11', 271.05, 'despesa', 1, '${PB}', 2),
    ('${A}', 'Salário', '2026-11', 5000, 'receita', null, null, null),
    ('${B}', 'Salário B', '2026-11', 3000, 'receita', null, null, null);
`

describe('FASE 1 — migration sobre dados legados', () => {
  let b: Banco

  beforeAll(async () => {
    b = await criarBanco({ dadosAntes: DADOS_LEGADOS })
  })

  it('todas as migrations podem ser reaplicadas (idempotentes)', async () => {
    for (const arquivo of listarMigrations()) {
      await aplicar(b.db, lerMigration(arquivo))
    }
  })

  it('preserva os registros existentes e deixa o status desconhecido', async () => {
    const linhas = await b.q<{ n: number; com_status: number }>(
      `select count(*)::int n, count(status_pagamento)::int com_status from transacoes`
    )
    expect(linhas[0]).toEqual({ n: 6, com_status: 0 })
  })

  it('preserva o valor contratado do parcelamento divergente', async () => {
    const [p] = await b.q<{ valor_contratado: string; valor_total: string }>(
      `select valor_contratado, valor_total from parcelamentos where id = $1`, [PB]
    )
    expect(Number(p.valor_contratado)).toBe(548.46)
    expect(Number(p.valor_total)).toBe(548.46)
  })

  it('substitui a FK simples pela composta, sem ambiguidade', async () => {
    const fks = await b.q<{ conname: string }>(
      `select conname from pg_constraint where conrelid = 'public.transacoes'::regclass
        and contype = 'f' and confrelid = 'public.parcelamentos'::regclass`
    )
    expect(fks.map((f) => f.conname)).toEqual(['transacoes_parcelamento_usuario_fkey'])
  })

  it('impede vincular transação ao parcelamento de outro usuário', async () => {
    const erro = await b.erro(() =>
      b.qComo(B, `insert into transacoes (usuario_id, nome, mes_referencia, valor_estimado, tipo, parcelamento_id, numero_parcela)
                  values ('${B}', 'x', '2026-11', 1, 'despesa', '${PA}', 9)`)
    )
    expect(erro).toMatch(/^23503/)
  })

  it('nenhuma função é executável por anon', async () => {
    const abertas = await b.q<{ proname: string }>(
      `select proname from pg_proc where pronamespace = 'public'::regnamespace
        and (array_to_string(proacl, ',') ~ '(^|,)anon=' or array_to_string(proacl, ',') ~ '(^|,)=X' or proacl is null)`
    )
    expect(abertas).toEqual([])
  })
})

describe('FASE 1 — RPCs de parcelamento', () => {
  let b: Banco

  beforeAll(async () => {
    b = await criarBanco({ dadosAntes: DADOS_LEGADOS })
  })

  it('cria parcelamento com soma exata e preserva valor contratado nas edições', async () => {
    const [{ id }] = await b.qComo<{ id: string }>(A,
      `select criar_parcelamento('TV', 'despesa', 2, '2026-11', array[33.34, 33.33, 33.33]::numeric[]) as id`)
    const parcelas = await b.q<{ id: string; mes_referencia: string; valor_estimado: string }>(
      `select id, mes_referencia, valor_estimado from transacoes where parcelamento_id = $1 order by numero_parcela`, [id])
    expect(parcelas.map((p) => p.mes_referencia)).toEqual(['2026-11', '2026-12', '2027-01'])

    await b.qComo(A, `select editar_parcela($1, 'unica', 'TV', 50, '2026-12', 2)`, [parcelas[1].id])
    const [p] = await b.q<{ valor_total: string; valor_contratado: string }>(
      `select valor_total, valor_contratado from parcelamentos where id = $1`, [id])
    expect(Number(p.valor_total)).toBe(116.67)
    expect(Number(p.valor_contratado)).toBe(100)

    const outras = await b.q<{ valor_estimado: string }>(
      `select valor_estimado from transacoes where parcelamento_id = $1 and numero_parcela <> 2 order by numero_parcela`, [id])
    expect(outras.map((o) => Number(o.valor_estimado))).toEqual([33.34, 33.33])
  })

  it('exclusão individual não exclui o parcelamento; parcela paga é protegida', async () => {
    const [{ id }] = await b.qComo<{ id: string }>(A,
      `select criar_parcelamento('Mesa', 'despesa', 1, '2026-11', array[10, 10, 10]::numeric[]) as id`)
    const ps = await b.q<{ id: string }>(`select id from transacoes where parcelamento_id = $1 order by numero_parcela`, [id])

    await b.qComo(A, `update transacoes set status_pagamento = 'pago', pago_em = now() where id = $1`, [ps[0].id])
    expect(await b.erro(() => b.qComo(A, `select excluir_parcela($1)`, [ps[0].id]))).toMatch(/paga/)

    await b.qComo(A, `select excluir_parcela($1)`, [ps[2].id])
    const [p] = await b.q<{ total_parcelas: number }>(`select total_parcelas from parcelamentos where id = $1`, [id])
    expect(p.total_parcelas).toBe(2)
  })

  it('isola usuários nas RPCs', async () => {
    const [parcela] = await b.q<{ id: string }>(`select id from transacoes where parcelamento_id = $1 limit 1`, [PA])
    expect(await b.erro(() => b.qComo(B, `select editar_parcela($1, 'unica', 'x', 1, '2026-11', 1)`, [parcela.id]))).toMatch(/não encontrada/)
    expect(await b.erro(() => b.qComo(B, `select excluir_parcelamento($1)`, [PA]))).toMatch(/não encontrado/)
    expect(await b.erro(() => b.qComo(null, `select excluir_parcelamento($1)`, [PA]))).not.toBeNull()
  })

  it('exclusão completa remove todas as parcelas', async () => {
    const [{ n }] = await b.qComo<{ n: number }>(A, `select excluir_parcelamento($1) as n`, [PB])
    expect(n).toBe(2)
    expect((await b.q(`select 1 from transacoes where parcelamento_id = $1`, [PB])).length).toBe(0)
  })
})
