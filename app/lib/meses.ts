/*
 * Utilitários para meses de referência no formato "YYYY-MM".
 *
 * Toda a aritmética é feita com inteiros (ano * 12 + mês), sem usar
 * Date, para evitar problemas de fuso horário e horário de verão.
 */

const PADRAO_MES = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Remove espaços e valida o formato YYYY-MM. Retorna null se inválido. */
export function normalizarMes(valor: string): string | null {
  const mes = valor.trim().replace(/\s/g, '')

  return PADRAO_MES.test(mes) ? mes : null
}

export function mesValido(valor: string): boolean {
  return normalizarMes(valor) !== null
}

function paraIndice(mes: string): number {
  const normalizado = normalizarMes(mes)

  if (!normalizado) {
    throw new Error(`Mês inválido: "${mes}". Use o formato YYYY-MM.`)
  }

  const [ano, numero] = normalizado.split('-').map(Number)

  return ano * 12 + (numero - 1)
}

function deIndice(indice: number): string {
  const ano = Math.floor(indice / 12)
  const numero = (indice % 12) + 1

  return `${String(ano).padStart(4, '0')}-${String(numero).padStart(2, '0')}`
}

/** Soma (ou subtrai) meses: adicionarMeses("2026-11", 3) → "2027-02". */
export function adicionarMeses(mes: string, quantidade: number): string {
  if (!Number.isInteger(quantidade)) {
    throw new Error('A quantidade de meses deve ser inteira.')
  }

  return deIndice(paraIndice(mes) + quantidade)
}

/** Diferença em meses: diferencaMeses("2026-01", "2026-04") → 3. */
export function diferencaMeses(de: string, ate: string): number {
  return paraIndice(ate) - paraIndice(de)
}

/** Compara dois meses (negativo se a < b, 0 se iguais, positivo se a > b). */
export function compararMeses(a: string, b: string): number {
  return paraIndice(a) - paraIndice(b)
}

/** Mês corrente no fuso local do ambiente: "YYYY-MM". */
export function mesCorrente(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`
}

/** "2026-09" → "setembro de 2026". */
export function formatarMes(mes: string): string {
  const [ano, numero] = mes.split('-').map(Number)

  return new Date(ano, numero - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
}

/** "2026-09" → "set. 2026". */
export function formatarMesCurto(mes: string): string {
  const [ano, numero] = mes.split('-').map(Number)

  return new Date(ano, numero - 1, 1).toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
  })
}
