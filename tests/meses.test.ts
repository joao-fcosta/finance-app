import { describe, expect, it } from 'vitest'
import {
  adicionarMeses,
  compararMeses,
  diferencaMeses,
  mesCorrente,
  normalizarMes,
} from '../app/lib/meses'

describe('meses de referência', () => {
  it('soma meses atravessando o ano', () => {
    expect(adicionarMeses('2026-11', 1)).toBe('2026-12')
    expect(adicionarMeses('2026-11', 2)).toBe('2027-01')
    expect(adicionarMeses('2026-01', -1)).toBe('2025-12')
    expect(adicionarMeses('2026-01', 24)).toBe('2028-01')
  })

  it('gera 12 parcelas mensais consecutivas sem pular meses', () => {
    const meses = Array.from({ length: 12 }, (_, i) => adicionarMeses('2026-03', i))
    expect(meses).toEqual([
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
      '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02',
    ])
  })

  it('calcula diferença e comparação', () => {
    expect(diferencaMeses('2026-10', '2027-02')).toBe(4)
    expect(diferencaMeses('2027-02', '2026-10')).toBe(-4)
    expect(compararMeses('2026-09', '2026-10')).toBeLessThan(0)
    expect(compararMeses('2026-10', '2026-10')).toBe(0)
  })

  it('normaliza e valida', () => {
    expect(normalizarMes(' 2026 -09 ')).toBe('2026-09')
    expect(normalizarMes('2026-13')).toBeNull()
    expect(normalizarMes('2026-9')).toBeNull()
    expect(() => adicionarMeses('abc', 1)).toThrow()
  })

  it('mês corrente no formato YYYY-MM', () => {
    expect(mesCorrente(new Date(2026, 0, 31))).toBe('2026-01')
  })
})
