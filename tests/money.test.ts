import { describe, expect, it } from 'vitest'
import {
  MAX_CENTAVOS,
  centavosParaReais,
  centavosParaTextoCampo,
  distribuirParcelas,
  formatarCentavos,
  reaisParaCentavos,
  somarCentavos,
  textoParaCentavos,
} from '../app/lib/money'

describe('distribuirParcelas', () => {
  it('R$ 100,00 em 3x → 33,34 + 33,33 + 33,33', () => {
    expect(distribuirParcelas(10000, 3)).toEqual([3334, 3333, 3333])
  })

  it('distribui os centavos excedentes a partir da primeira parcela', () => {
    // 1000 / 7 = 142 resto 6 → seis parcelas de 143 e uma de 142
    expect(distribuirParcelas(1000, 7)).toEqual([143, 143, 143, 143, 143, 143, 142])
  })

  it('divisão exata gera parcelas iguais', () => {
    expect(distribuirParcelas(120000, 12)).toEqual(Array(12).fill(10000))
  })

  it('1 parcela retorna o próprio total', () => {
    expect(distribuirParcelas(4999, 1)).toEqual([4999])
  })

  it('a soma é sempre exatamente o total (varredura)', () => {
    for (let total = 1; total <= 2500; total += 7) {
      for (let quantidade = 1; quantidade <= Math.min(total, 48); quantidade++) {
        const parcelas = distribuirParcelas(total, quantidade)

        expect(parcelas).toHaveLength(quantidade)
        expect(somarCentavos(parcelas)).toBe(total)
        // Diferença máxima de 1 centavo entre parcelas
        expect(Math.max(...parcelas) - Math.min(...parcelas)).toBeLessThanOrEqual(1)
        // Nunca crescente: parcelas maiores vêm primeiro
        expect([...parcelas].sort((a, b) => b - a)).toEqual(parcelas)
      }
    }
  })

  it('valores grandes não perdem centavos', () => {
    const parcelas = distribuirParcelas(999_999_999_99, 420)
    expect(somarCentavos(parcelas)).toBe(999_999_999_99)
  })

  it('rejeita entradas inválidas', () => {
    expect(() => distribuirParcelas(0, 3)).toThrow()
    expect(() => distribuirParcelas(-100, 3)).toThrow()
    expect(() => distribuirParcelas(100.5, 3)).toThrow()
    expect(() => distribuirParcelas(100, 0)).toThrow()
    expect(() => distribuirParcelas(100, 2.5)).toThrow()
    expect(() => distribuirParcelas(2, 3)).toThrow()
  })
})

describe('conversão reais ↔ centavos', () => {
  it('converte sem erro de ponto flutuante', () => {
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30)
    expect(reaisParaCentavos(1.005)).toBe(101)
    expect(reaisParaCentavos(33.33)).toBe(3333)
    expect(reaisParaCentavos(1234.56)).toBe(123456)
    expect(reaisParaCentavos(-10.1)).toBe(-1010)
  })

  it('ida e volta preserva o valor', () => {
    for (const centavos of [1, 99, 3333, 3334, 123456, 99999999]) {
      expect(reaisParaCentavos(centavosParaReais(centavos))).toBe(centavos)
    }
  })

  it('rejeita valores inválidos', () => {
    expect(() => reaisParaCentavos(Number.NaN)).toThrow()
    expect(() => centavosParaReais(1.5)).toThrow()
  })
})

describe('máscara de valor monetário', () => {
  it('interpreta dígitos a partir dos centavos', () => {
    expect(textoParaCentavos('')).toBe(0)
    expect(textoParaCentavos('1')).toBe(1)
    expect(textoParaCentavos('1234')).toBe(1234)
    expect(textoParaCentavos('R$ 1.234,56')).toBe(123456)
    expect(textoParaCentavos('000150')).toBe(150)
  })

  it('limita ao máximo de numeric(10,2): R$ 99.999.999,99', () => {
    expect(MAX_CENTAVOS).toBe(9_999_999_999)
    expect(textoParaCentavos('9'.repeat(20))).toBe(MAX_CENTAVOS)
    expect(textoParaCentavos('99999999999')).toBe(MAX_CENTAVOS) // 11º dígito ignorado
    expect(centavosParaReais(MAX_CENTAVOS)).toBe(99_999_999.99)
    expect(centavosParaTextoCampo(MAX_CENTAVOS)).toBe('99.999.999,99')
  })

  it('o maior valor possível ainda se distribui sem perder centavos', () => {
    expect(somarCentavos(distribuirParcelas(MAX_CENTAVOS, 120))).toBe(MAX_CENTAVOS)
  })

  it('formata o texto do campo', () => {
    expect(centavosParaTextoCampo(0)).toBe('')
    expect(centavosParaTextoCampo(1)).toBe('0,01')
    expect(centavosParaTextoCampo(123456)).toBe('1.234,56')
  })

  it('formata moeda em Real', () => {
    // Intl usa espaço não separável entre "R$" e o número
    expect(formatarCentavos(3334).replace(/\s/g, ' ')).toBe('R$ 33,34')
  })
})
