import { describe, expect, it } from 'vitest'
import {
  FaturaPainel,
  TransacaoPainel,
  compromissosFuturos,
  contaEstaPendente,
  montarCompromissos,
  proximosVencimentos,
  resumirMes,
} from '../app/lib/painel'

let seq = 0
const t = (campos: Partial<TransacaoPainel>): TransacaoPainel => ({
  id: `t${++seq}`,
  nome: 'Conta',
  tipo: 'despesa',
  valor_estimado: 100,
  valor_real: null,
  mes_referencia: '2026-11',
  categoria_id: 1,
  status_pagamento: 'pendente',
  data_vencimento: null,
  fatura_id: null,
  recorrencia_id: null,
  parcelamento_id: null,
  ...campos,
})

const fatura = (campos: Partial<FaturaPainel>): FaturaPainel => ({
  id: 'f1',
  cartao_id: 'c1',
  cartao_nome: 'Nubank',
  mes_referencia: '2026-11',
  data_vencimento: '2026-11-10',
  totalCentavos: 0,
  pagoCentavos: 0,
  ...campos,
})

describe('resumo do mês — sem contagem duplicada', () => {
  // Novembro: salário 3000; aluguel 1000 pago; internet 100 pendente;
  // compras no cartão 300 + 200 na fatura de nov (total 500, pago 200).
  const transacoes = [
    t({ tipo: 'receita', nome: 'Salário', valor_estimado: 3000, categoria_id: null }),
    t({ nome: 'Aluguel', valor_estimado: 1000, status_pagamento: 'pago' }),
    t({ nome: 'Internet', valor_estimado: 100, recorrencia_id: 'r1', data_vencimento: '2026-11-15' }),
    t({ nome: 'Mercado', valor_estimado: 300, fatura_id: 'f1', categoria_id: 1 }),
    t({ nome: 'Cinema', valor_estimado: 200, fatura_id: 'f1', categoria_id: 2 }),
  ]
  const faturas = [fatura({ totalCentavos: 50000, pagoCentavos: 20000 })]
  const r = resumirMes(transacoes, faturas)

  it('compras no cartão contam uma única vez como despesa', () => {
    expect(r.receitasCentavos).toBe(300000)
    expect(r.despesasCentavos).toBe(160000) // 1000 + 100 + 300 + 200
    expect(r.saldoPrevistoCentavos).toBe(140000)
  })

  it('a pagar = contas pendentes + saldo da fatura (compras não entram duas vezes)', () => {
    expect(r.aPagarCentavos).toBe(10000 + 30000)
    expect(r.contasPendentes).toBe(1)
    expect(r.faturasEmAbertoCentavos).toBe(30000)
  })

  it('pagamento de fatura reduz o disponível sem virar despesa', () => {
    expect(r.pagoCentavos).toBe(100000 + 20000)
    expect(r.disponivelCentavos).toBe(300000 - 120000)
    // identidade: despesas = pago + a pagar
    expect(r.pagoCentavos + r.aPagarCentavos).toBe(r.despesasCentavos)
  })

  it('distribui por categoria incluindo compras no cartão', () => {
    expect(r.porCategoria).toEqual({ 1: 140000, 2: 20000, 3: 0 })
  })

  it('fatura totalmente paga zera o a pagar dela', () => {
    const paga = resumirMes(transacoes, [fatura({ totalCentavos: 50000, pagoCentavos: 50000 })])
    expect(paga.faturasEmAbertoCentavos).toBe(0)
    expect(paga.pagoCentavos + paga.aPagarCentavos).toBe(paga.despesasCentavos)
  })
})

describe('compromissos e vencimentos', () => {
  const hoje = '2026-11-18'

  it('status desconhecido só conta como pendente do mês atual em diante', () => {
    expect(contaEstaPendente({ status_pagamento: null, mes_referencia: '2026-10' }, '2026-11')).toBe(false)
    expect(contaEstaPendente({ status_pagamento: null, mes_referencia: '2026-11' }, '2026-11')).toBe(true)
    expect(contaEstaPendente({ status_pagamento: 'pendente', mes_referencia: '2026-10' }, '2026-11')).toBe(true)
    expect(contaEstaPendente({ status_pagamento: 'pago', mes_referencia: '2026-12' }, '2026-11')).toBe(false)
  })

  const transacoes = [
    t({ nome: 'Barbeiro', valor_estimado: 50, recorrencia_id: 'r1', data_vencimento: '2026-11-10' }), // vencida
    t({ nome: 'Internet', valor_estimado: 100, recorrencia_id: 'r2', data_vencimento: '2026-11-25' }),
    t({ nome: 'Notebook (2/10)', valor_estimado: 250, parcelamento_id: 'p1', mes_referencia: '2026-12' }),
    t({ nome: 'Velha', valor_estimado: 70, status_pagamento: null, mes_referencia: '2026-09' }), // antiga: ignorada
    t({ nome: 'Paga', valor_estimado: 999, status_pagamento: 'pago', data_vencimento: '2026-11-20' }),
    t({ nome: 'No cartão', valor_estimado: 850, fatura_id: 'f1', mes_referencia: '2026-12' }), // via fatura
    t({ tipo: 'receita', nome: 'Salário', valor_estimado: 3000, categoria_id: null }),
  ]
  const faturas = [
    fatura({ id: 'f1', mes_referencia: '2026-12', data_vencimento: '2026-12-05', totalCentavos: 85000, pagoCentavos: 0 }),
    fatura({ id: 'f2', mes_referencia: '2027-01', data_vencimento: '2027-01-05', totalCentavos: 0 }),
  ]
  const compromissos = montarCompromissos(transacoes, faturas, hoje)

  it('lista contas pendentes e faturas, sem duplicar compras do cartão', () => {
    expect(compromissos.map((c) => c.nome)).toEqual(['Barbeiro', 'Internet', 'Fatura Nubank', 'Notebook (2/10)'])
    expect(compromissos.find((c) => c.nome === 'Fatura Nubank')?.valorCentavos).toBe(85000)
    expect(compromissos.some((c) => c.nome === 'No cartão')).toBe(false)
    expect(compromissos.map((c) => c.origem)).toEqual(['recorrente', 'recorrente', 'fatura', 'parcela'])
  })

  it('marca vencidas e filtra os próximos 30 dias', () => {
    expect(compromissos.filter((c) => c.vencida).map((c) => c.nome)).toEqual(['Barbeiro'])
    expect(proximosVencimentos(compromissos, hoje).map((c) => c.nome)).toEqual(['Barbeiro', 'Internet', 'Fatura Nubank'])
    expect(proximosVencimentos(compromissos, hoje, 60).map((c) => c.nome)).toContain('Notebook (2/10)')
  })

  it('soma compromissos dos próximos meses', () => {
    const futuros = compromissosFuturos(compromissos, '2026-11', 3)
    expect(futuros).toEqual([
      { mes: '2026-12', contasCentavos: 25000, faturasCentavos: 85000, totalCentavos: 110000, quantidade: 2 },
      { mes: '2027-01', contasCentavos: 0, faturasCentavos: 0, totalCentavos: 0, quantidade: 0 },
      { mes: '2027-02', contasCentavos: 0, faturasCentavos: 0, totalCentavos: 0, quantidade: 0 },
    ])
  })
})
