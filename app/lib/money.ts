/*
 * Utilitários monetários.
 *
 * Todos os cálculos são feitos em CENTAVOS INTEIROS para evitar erros
 * de ponto flutuante (ex.: 0.1 + 0.2 !== 0.3). A conversão para reais
 * acontece apenas na borda (exibição e persistência).
 */

/**
 * Converte um valor em reais (number) para centavos inteiros.
 *
 * Usa arredondamento "half away from zero" sobre a representação
 * textual com 2 casas, evitando que 1.005 vire 100 por imprecisão
 * binária.
 */
export function reaisParaCentavos(valor: number): number {
  if (!Number.isFinite(valor)) {
    throw new Error('Valor monetário inválido.')
  }

  const sinal = valor < 0 ? -1 : 1
  const absoluto = Math.abs(valor)

  // Number.EPSILON corrige casos como 1.005 * 100 = 100.49999...
  const centavos = Math.round((absoluto + Number.EPSILON) * 100)

  return sinal * centavos
}

/** Converte centavos inteiros para reais (number com até 2 casas). */
export function centavosParaReais(centavos: number): number {
  if (!Number.isInteger(centavos)) {
    throw new Error('Centavos devem ser um número inteiro.')
  }

  return centavos / 100
}

/**
 * Distribui um valor total (em centavos) entre N parcelas sem perder
 * nenhum centavo.
 *
 * Regra de distribuição dos centavos excedentes:
 *   o resto da divisão inteira é distribuído, 1 centavo por parcela,
 *   a partir da PRIMEIRA parcela.
 *
 * Exemplo: 10000 centavos (R$ 100,00) em 3 parcelas
 *   base = 3333, resto = 1
 *   → [3334, 3333, 3333]   soma = 10000
 *
 * A soma do resultado é sempre exatamente igual a `totalCentavos`.
 */
export function distribuirParcelas(
  totalCentavos: number,
  quantidade: number
): number[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) {
    throw new Error('O valor total deve ser um inteiro positivo em centavos.')
  }

  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new Error('A quantidade de parcelas deve ser um inteiro maior que zero.')
  }

  if (quantidade > totalCentavos) {
    throw new Error('O valor total é menor que um centavo por parcela.')
  }

  const base = Math.floor(totalCentavos / quantidade)
  const resto = totalCentavos % quantidade

  return Array.from({ length: quantidade }, (_, indice) =>
    indice < resto ? base + 1 : base
  )
}

/** Soma uma lista de centavos (inteiros). */
export function somarCentavos(valores: number[]): number {
  return valores.reduce((total, valor) => total + valor, 0)
}

const formatadorBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Formata um valor em reais como moeda brasileira (R$ 1.234,56). */
export function formatarMoeda(valor: number): string {
  return formatadorBRL.format(valor)
}

/** Formata centavos inteiros como moeda brasileira. */
export function formatarCentavos(centavos: number): string {
  return formatadorBRL.format(centavos / 100)
}

/*
 * =====================================================
 * MÁSCARA DE ENTRADA MONETÁRIA
 * =====================================================
 *
 * O campo de valor funciona como em apps bancários: o usuário digita
 * apenas números e eles preenchem a partir dos centavos.
 *
 *   "1"     → R$ 0,01
 *   "1234"  → R$ 12,34
 *
 * Isso permite usar inputMode="numeric" (teclado numérico simples no
 * celular) e elimina ambiguidade entre vírgula e ponto.
 */

/**
 * Maior valor aceito pelas colunas numeric(10,2) do banco:
 * R$ 99.999.999,99 = 9.999.999.999 centavos (10 dígitos).
 */
export const MAX_CENTAVOS = 9_999_999_999

const MAX_DIGITOS = String(MAX_CENTAVOS).length

/**
 * Extrai centavos de qualquer texto digitado (mantém só os dígitos).
 * Dígitos além do limite de numeric(10,2) são ignorados.
 */
export function textoParaCentavos(texto: string): number {
  const digitos = texto.replace(/\D/g, '').replace(/^0+/, '')

  if (!digitos) {
    return 0
  }

  return Number(digitos.slice(0, MAX_DIGITOS))
}

/** Texto exibido no campo de valor (sem o prefixo "R$"). */
export function centavosParaTextoCampo(centavos: number): string {
  if (!centavos) {
    return ''
  }

  return (centavos / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
