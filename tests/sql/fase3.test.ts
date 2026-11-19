import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cicloDaCompra } from '../../app/lib/cartoes'
import { adicionarDias } from '../../app/lib/datas'
import { Banco, USUARIO_A as A, USUARIO_B as B, criarBanco } from './banco'

const fixarHoje = (b: Banco, data: string) => b.db.exec(`select set_config('app.hoje', '${data}', false)`)

async function criarCartao(b: Banco, usuario: string, fechamento = 25, vencimento = 5, limite = 5000): Promise<string> {
  const [{ id }] = await b.qComo<{ id: string }>(usuario,
    `insert into cartoes (usuario_id, nome, limite, dia_fechamento, dia_vencimento)
     values ('${usuario}', 'Nubank', ${limite}, ${fechamento}, ${vencimento}) returning id`)
  return id
}

const comprar = async (b: Banco, usuario: string, cartao: string, data: string, valores: number[], nome = 'Compra') =>
  (await b.qComo<{ id: string }>(usuario,
    `select registrar_compra_cartao($1, $2, 2, $3::date, $4::numeric[]) as id`, [cartao, nome, data, valores]))[0].id

interface LinhaCompra { nome: string; mes_referencia: string; mes_fatura: string; fechamento: string; vencimento: string; valor_estimado: string }

const comprasDoCartao = (b: Banco, cartao: string) =>
  b.q<LinhaCompra>(`
    select t.nome, t.mes_referencia, f.mes_referencia mes_fatura,
           to_char(f.data_fechamento, 'YYYY-MM-DD') fechamento, to_char(f.data_vencimento, 'YYYY-MM-DD') vencimento, t.valor_estimado
      from transacoes t join faturas f on f.id = t.fatura_id
     where t.cartao_id = $1 order by t.data_compra, t.numero_parcela nulls first`, [cartao])

describe('FASE 3 — paridade SQL × TypeScript do ciclo da fatura', () => {
  let b: Banco
  beforeAll(async () => { b = await criarBanco() })

  it('mesmo resultado para centenas de datas e regras de cartão', async () => {
    const regras = [[25, 5], [5, 15], [31, 10], [1, 1], [28, 28], [10, 20], [30, 7]]
    const casos: { f: number; v: number; d: string; i: number }[] = []
    for (const [f, v] of regras) {
      for (let dia = 0; dia < 400; dia += 9) {
        casos.push({ f, v, d: adicionarDias('2027-01-01', dia), i: dia % 4 })
      }
    }

    const linhas = await b.q<{ k: number; mes: string; fech: string; venc: string }>(`
      select k, c.mes_referencia mes, to_char(c.data_fechamento, 'YYYY-MM-DD') fech, to_char(c.data_vencimento, 'YYYY-MM-DD') venc
        from jsonb_array_elements($1::jsonb) with ordinality as x(caso, k),
             lateral fase3_ciclo_fatura((caso->>'f')::int, (caso->>'v')::int, (caso->>'d')::date, (caso->>'i')::int) c
       order by k`, [JSON.stringify(casos)])

    linhas.forEach((linha, indice) => {
      const caso = casos[indice]
      const ts = cicloDaCompra({ dia_fechamento: caso.f, dia_vencimento: caso.v }, caso.d, caso.i)
      expect({ mes: linha.mes, fech: linha.fech, venc: linha.venc }, JSON.stringify(caso)).toEqual({
        mes: ts.mes_referencia, fech: ts.data_fechamento, venc: ts.data_vencimento,
      })
    })
    expect(linhas.length).toBe(casos.length)
  })
})

describe('FASE 3 — compras no cartão', () => {
  let b: Banco
  let cartao: string

  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-11-18')
    cartao = await criarCartao(b, A)
  })

  it('compra antes e depois do fechamento', async () => {
    await comprar(b, A, cartao, '2026-11-20', [100], 'Antes')
    await comprar(b, A, cartao, '2026-11-27', [200], 'Depois')
    const compras = await comprasDoCartao(b, cartao)
    expect(compras.map((c) => [c.nome, c.mes_referencia, c.fechamento, c.vencimento])).toEqual([
      ['Antes', '2026-12', '2026-11-25', '2026-12-05'],
      ['Depois', '2027-01', '2026-12-25', '2027-01-05'],
    ])
    // mes_referencia da transação = mês da fatura
    expect(compras.every((c) => c.mes_referencia === c.mes_fatura)).toBe(true)
  })

  it('compra parcelada distribui uma parcela por fatura, com soma exata', async () => {
    const pid = await comprar(b, A, cartao, '2026-11-27', [33.34, 33.33, 33.33], 'Fone')
    const compras = await comprasDoCartao(b, cartao)
    expect(compras.map((c) => [c.nome, c.mes_fatura, Number(c.valor_estimado)])).toEqual([
      ['Fone (1/3)', '2027-01', 33.34],
      ['Fone (2/3)', '2027-02', 33.33],
      ['Fone (3/3)', '2027-03', 33.33],
    ])
    const [p] = await b.q<{ valor_total: string; valor_contratado: string; total_parcelas: number }>(
      `select valor_total, valor_contratado, total_parcelas from parcelamentos where id = $1`, [pid])
    expect([Number(p.valor_total), Number(p.valor_contratado), p.total_parcelas]).toEqual([100, 100, 3])
  })

  it('várias compras no mesmo ciclo usam a mesma fatura (sem duplicar)', async () => {
    await comprar(b, A, cartao, '2026-11-01', [10])
    await comprar(b, A, cartao, '2026-11-10', [20])
    await comprar(b, A, cartao, '2026-11-24', [30])
    const faturas = await b.q(`select * from faturas where cartao_id = $1`, [cartao])
    expect(faturas.length).toBe(1)
  })

  it('parcela no cartão não pode mudar de mês; valor e nome podem', async () => {
    await comprar(b, A, cartao, '2026-11-20', [50, 50], 'TV')
    const [p1] = await b.q<{ id: string }>(`select id from transacoes where cartao_id = $1 order by numero_parcela limit 1`, [cartao])
    expect(await b.erro(() => b.qComo(A, `select editar_parcela($1, 'unica', 'TV', 50, '2027-05', 2)`, [p1.id]))).toMatch(/fatura/)
    expect(await b.erro(() => b.qComo(A, `select editar_parcela($1, 'unica', 'TV 50"', 55, '2026-12', 2)`, [p1.id]))).toBeNull()
  })

  it('valida cartão inativo, valores e transação incoerente', async () => {
    await b.qComo(A, `update cartoes set ativo = false where id = $1`, [cartao])
    expect(await b.erro(() => comprar(b, A, cartao, '2026-11-20', [10]))).toMatch(/inativo/)
    await b.qComo(A, `update cartoes set ativo = true where id = $1`, [cartao])
    expect(await b.erro(() => comprar(b, A, cartao, '2026-11-20', [10.001]))).toMatch(/inválido/)
    // crédito sem fatura é rejeitado pela constraint
    expect(await b.erro(() => b.qComo(A,
      `insert into transacoes (usuario_id, nome, mes_referencia, valor_estimado, tipo, forma_pagamento, cartao_id)
       values ('${A}', 'x', '2026-11', 1, 'despesa', 'credito', '${cartao}')`))).toMatch(/transacoes_credito_check/)
    // compras rejeitadas não deixam faturas órfãs (operação atômica)
    const [f] = await b.q<{ id: string }>(`select id from faturas limit 1`)
    expect(f).toBeUndefined()
  })
})

describe('FASE 3 — pagamento de fatura', () => {
  let b: Banco
  let cartao: string
  let fatura: string

  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-11-28')
    cartao = await criarCartao(b, A)
    await comprar(b, A, cartao, '2026-11-10', [300])
    await comprar(b, A, cartao, '2026-11-20', [200])
    fatura = (await b.q<{ id: string }>(`select id from faturas where cartao_id = $1`, [cartao]))[0].id
  })

  const totais = async () => (await b.q<{ despesas: string; pagamentos: string; transacoes: number }>(`
    select (select sum(valor_estimado) from transacoes where usuario_id = '${A}') despesas,
           (select coalesce(sum(valor), 0) from pagamentos_fatura where usuario_id = '${A}') pagamentos,
           (select count(*)::int from transacoes where usuario_id = '${A}') transacoes`))[0]

  it('pagamento parcial e depois total, sem criar despesa', async () => {
    await b.qComo(A, `select pagar_fatura($1, 200, '2026-12-01')`, [fatura])
    await b.qComo(A, `select pagar_fatura($1, 300, '2026-12-04')`, [fatura])
    const t = await totais()
    expect(Number(t.despesas)).toBe(500) // as compras continuam sendo as únicas despesas
    expect(Number(t.pagamentos)).toBe(500)
    expect(t.transacoes).toBe(2) // pagamento não gerou transação
    expect(await b.erro(() => b.qComo(A, `select pagar_fatura($1, 1, null)`, [fatura]))).toMatch(/já está paga/)
  })

  it('não aceita pagar mais que o saldo', async () => {
    await b.qComo(A, `select pagar_fatura($1, 450, null)`, [fatura])
    expect(await b.erro(() => b.qComo(A, `select pagar_fatura($1, 60, null)`, [fatura]))).toMatch(/excede o saldo/)
    expect(await b.erro(() => b.qComo(A, `select pagar_fatura($1, 0, null)`, [fatura]))).toMatch(/válido/)
  })

  it('limite utilizado considera compras e pagamentos', async () => {
    await comprar(b, A, cartao, '2026-11-20', [100, 100, 100]) // parcelas futuras também consomem
    await b.qComo(A, `select pagar_fatura($1, 500, null)`, [fatura])
    const [l] = await b.q<{ compras: string; pagos: string }>(`
      select (select sum(valor_estimado) from transacoes where cartao_id = $1) compras,
             (select sum(p.valor) from pagamentos_fatura p join faturas f on f.id = p.fatura_id where f.cartao_id = $1) pagos`, [cartao])
    expect(Number(l.compras) - Number(l.pagos)).toBe(300)
  })

  it('outro usuário não paga nem vê a fatura', async () => {
    expect(await b.erro(() => b.qComo(B, `select pagar_fatura($1, 10, null)`, [fatura]))).toMatch(/não encontrada/)
    expect((await b.qComo(B, `select * from faturas`)).length).toBe(0)
    expect((await b.qComo(B, `select * from cartoes`)).length).toBe(0)
    expect((await b.qComo(B, `select * from pagamentos_fatura`)).length).toBe(0)
  })
})

describe('FASE 3 — isolamento e integridade', () => {
  let b: Banco
  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-11-18')
  })

  it('B não usa o cartão nem a fatura de A', async () => {
    const cartaoA = await criarCartao(b, A)
    await comprar(b, A, cartaoA, '2026-11-10', [10])
    const [fatura] = await b.q<{ id: string }>(`select id from faturas where cartao_id = $1`, [cartaoA])

    expect(await b.erro(() => comprar(b, B, cartaoA, '2026-11-10', [10]))).toMatch(/não encontrado/)
    expect(await b.erro(() => b.qComo(B,
      `insert into transacoes (usuario_id, nome, mes_referencia, valor_estimado, tipo, forma_pagamento, cartao_id, fatura_id)
       values ('${B}', 'x', '2026-12', 1, 'despesa', 'credito', '${cartaoA}', '${fatura.id}')`))).toMatch(/^23503/)
    expect(await b.erro(() => b.qComo(B,
      `insert into pagamentos_fatura (usuario_id, fatura_id, valor, data_pagamento) values ('${B}', '${fatura.id}', 1, '2026-11-20')`))).toMatch(/^23503/)
  })

  it('cartão com compras não pode ser excluído; sem compras, pode', async () => {
    const usado = await criarCartao(b, A)
    await comprar(b, A, usado, '2026-11-10', [10])
    expect(await b.erro(() => b.qComo(A, `delete from cartoes where id = $1`, [usado]))).toMatch(/^23503/)

    const novo = await criarCartao(b, A)
    expect(await b.erro(() => b.qComo(A, `delete from cartoes where id = $1`, [novo]))).toBeNull()
  })

  it('editar dias do cartão atualiza só faturas que ainda não fecharam', async () => {
    const cartao = await criarCartao(b, A)
    await comprar(b, A, cartao, '2026-10-10', [10]) // fatura que fechou em 25/10
    await comprar(b, A, cartao, '2026-11-10', [10]) // fatura aberta (fecha 25/11)
    await b.qComo(A, `select editar_cartao($1, 'Nubank', null, 5000, 20, 28, true)`, [cartao])
    const faturas = await b.q<{ mes_referencia: string; f: string; v: string }>(
      `select mes_referencia, to_char(data_fechamento, 'YYYY-MM-DD') f, to_char(data_vencimento, 'YYYY-MM-DD') v
         from faturas where cartao_id = $1 order by mes_referencia`, [cartao])
    expect(faturas).toEqual([
      { mes_referencia: '2026-11', f: '2026-10-25', v: '2026-11-05' }, // fechada: intacta
      { mes_referencia: '2026-12', f: '2026-12-20', v: '2026-12-28' }, // aberta: novas datas, mesmo mês
    ])
  })

  it('anon não acessa as tabelas novas', async () => {
    for (const t of ['cartoes', 'faturas', 'pagamentos_fatura']) {
      expect(await b.erro(() => b.qComo(null, `select * from ${t}`))).toMatch(/permission denied/)
    }
  })
})

describe('FASE 3 — recorrência no cartão', () => {
  it('cada cobrança entra na fatura da sua data, sem duplicar', async () => {
    const b = await criarBanco()
    await fixarHoje(b, '2026-11-18')
    const cartao = await criarCartao(b, A)

    const [{ id }] = await b.qComo<{ id: string }>(A,
      `select criar_recorrencia_v2('Streaming', 'despesa', 2, 39.90, 'mensal', 1, '2026-11-26', null, '2027-01-31', 'credito', $1) as id`, [cartao])
    await b.qComo(A, `select gerar_ocorrencias('2027-01-31')`)

    const linhas = await b.q<{ data: string; mes_referencia: string; mes_fatura: string; forma_pagamento: string }>(`
      select to_char(t.data_vencimento, 'YYYY-MM-DD') data, t.mes_referencia, f.mes_referencia mes_fatura, t.forma_pagamento
        from transacoes t join faturas f on f.id = t.fatura_id where t.recorrencia_id = $1 order by 1`, [id])
    // 26/11 (após fechar em 25/11) → fatura de jan; 26/12 → fev; 26/01 → mar
    expect(linhas.map((l) => [l.data, l.mes_fatura])).toEqual([
      ['2026-11-26', '2027-01'], ['2026-12-26', '2027-02'], ['2027-01-26', '2027-03'],
    ])
    expect(linhas.every((l) => l.mes_referencia === l.mes_fatura && l.forma_pagamento === 'credito')).toBe(true)

    expect(await b.erro(() => b.qComo(A,
      `select criar_recorrencia_v2('Salário', 'receita', null, 100, 'mensal', 1, '2026-11-01', null, null, 'credito', $1)`, [cartao]))).toMatch(/Somente despesas/)
  })

  it('recorrência comum (sem cartão) continua igual e guarda a forma de pagamento', async () => {
    const b = await criarBanco()
    await fixarHoje(b, '2026-11-18')
    const [{ id }] = await b.qComo<{ id: string }>(A,
      `select criar_recorrencia_v2('Aluguel', 'despesa', 1, 1500, 'mensal', 1, '2026-11-05', null, '2026-12-31', 'pix', null) as id`)
    const linhas = await b.q<{ mes_referencia: string; forma_pagamento: string; fatura_id: string | null }>(
      `select mes_referencia, forma_pagamento, fatura_id from transacoes where recorrencia_id = $1 order by 1`, [id])
    expect(linhas).toEqual([
      { mes_referencia: '2026-11', forma_pagamento: 'pix', fatura_id: null },
      { mes_referencia: '2026-12', forma_pagamento: 'pix', fatura_id: null },
    ])
  })
})
