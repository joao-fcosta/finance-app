import { describe, expect, it } from 'vitest'
import {
  cicloDaCompra,
  ciclosDasParcelas,
  limiteCartao,
  restanteFaturaCentavos,
  statusFatura,
} from '../app/lib/cartoes'

const fecha25vence5 = { dia_fechamento: 25, dia_vencimento: 5 }
const fecha5vence15 = { dia_fechamento: 5, dia_vencimento: 15 }

describe('ciclo da fatura', () => {
  it('exemplo do planejamento: fecha 25, vence 5', () => {
    // compra dia 20 → fatura que fecha em 25/11 e vence em 05/12
    expect(cicloDaCompra(fecha25vence5, '2026-11-20')).toEqual({
      mes_referencia: '2026-12', data_fechamento: '2026-11-25', data_vencimento: '2026-12-05',
    })
    // compra dia 27 → próxima fatura
    expect(cicloDaCompra(fecha25vence5, '2026-11-27')).toEqual({
      mes_referencia: '2027-01', data_fechamento: '2026-12-25', data_vencimento: '2027-01-05',
    })
  })

  it('compra no dia do fechamento vai para a próxima fatura', () => {
    expect(cicloDaCompra(fecha25vence5, '2026-11-25').mes_referencia).toBe('2027-01')
    expect(cicloDaCompra(fecha25vence5, '2026-11-24').mes_referencia).toBe('2026-12')
  })

  it('vencimento no mesmo mês quando vence depois de fechar', () => {
    expect(cicloDaCompra(fecha5vence15, '2026-11-03')).toEqual({
      mes_referencia: '2026-11', data_fechamento: '2026-11-05', data_vencimento: '2026-11-15',
    })
    expect(cicloDaCompra(fecha5vence15, '2026-11-10')).toEqual({
      mes_referencia: '2026-12', data_fechamento: '2026-12-05', data_vencimento: '2026-12-15',
    })
  })

  it('dias inexistentes usam o último dia do mês (fevereiro)', () => {
    const fecha31vence10 = { dia_fechamento: 31, dia_vencimento: 10 }
    expect(cicloDaCompra(fecha31vence10, '2027-02-20')).toEqual({
      mes_referencia: '2027-03', data_fechamento: '2027-02-28', data_vencimento: '2027-03-10',
    })
    // 28/02 é o fechamento: vai para a próxima
    expect(cicloDaCompra(fecha31vence10, '2027-02-28').data_fechamento).toBe('2027-03-31')
  })

  it('virada de ano', () => {
    expect(cicloDaCompra(fecha25vence5, '2026-12-26')).toEqual({
      mes_referencia: '2027-02', data_fechamento: '2027-01-25', data_vencimento: '2027-02-05',
    })
  })

  it('parcelas em faturas consecutivas', () => {
    expect(ciclosDasParcelas(fecha25vence5, '2026-11-27', 3).map((c) => c.mes_referencia)).toEqual([
      '2027-01', '2027-02', '2027-03',
    ])
  })
})

describe('status da fatura', () => {
  const base = { data_fechamento: '2026-11-25', data_vencimento: '2026-12-05' }

  it('aberta antes do fechamento; fechada depois', () => {
    expect(statusFatura({ ...base, totalCentavos: 1000, pagoCentavos: 0 }, '2026-11-24')).toBe('aberta')
    expect(statusFatura({ ...base, totalCentavos: 1000, pagoCentavos: 0 }, '2026-11-25')).toBe('fechada')
  })

  it('parcial, paga e vencida', () => {
    expect(statusFatura({ ...base, totalCentavos: 1000, pagoCentavos: 400 }, '2026-11-30')).toBe('parcial')
    expect(statusFatura({ ...base, totalCentavos: 1000, pagoCentavos: 1000 }, '2026-11-30')).toBe('paga')
    expect(statusFatura({ ...base, totalCentavos: 1000, pagoCentavos: 400 }, '2026-12-06')).toBe('vencida')
    expect(statusFatura({ ...base, totalCentavos: 0, pagoCentavos: 0 }, '2026-12-06')).toBe('vazia')
  })

  it('restante nunca é negativo', () => {
    expect(restanteFaturaCentavos({ totalCentavos: 1000, pagoCentavos: 400 })).toBe(600)
    expect(restanteFaturaCentavos({ totalCentavos: 1000, pagoCentavos: 1200 })).toBe(0)
  })
})

describe('limite do cartão', () => {
  it('compras consomem e pagamentos liberam', () => {
    expect(limiteCartao(500000, 120000, 20000)).toEqual({
      utilizadoCentavos: 100000, disponivelCentavos: 400000, percentualUtilizado: 20, acimaDoLimite: false,
    })
  })

  it('pagamento não deixa o utilizado negativo; acima do limite é sinalizado', () => {
    expect(limiteCartao(100000, 50000, 80000).utilizadoCentavos).toBe(0)
    const acima = limiteCartao(100000, 150000, 0)
    expect(acima.disponivelCentavos).toBe(-50000)
    expect(acima.acimaDoLimite).toBe(true)
    expect(acima.percentualUtilizado).toBe(100)
  })
})
