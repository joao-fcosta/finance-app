import { describe, expect, it } from 'vitest'
import {
  agruparParcelasPorAno,
  parcelasAfetadasPorEdicaoFutura,
  resumirParcelamento,
  situacaoParcela,
} from '../app/lib/parcelamentos'
import { adicionarMeses } from '../app/lib/meses'
import { centavosParaReais, distribuirParcelas } from '../app/lib/money'
import type { Parcela, StatusPagamento } from '../app/lib/types'
import { nomeBaseParcela } from '../app/lib/types'

function criarParcelas(
  totalCentavos: number,
  quantidade: number,
  mesInicio: string,
  status: StatusPagamento[] = []
): Parcela[] {
  return distribuirParcelas(totalCentavos, quantidade).map((centavos, i) => ({
    id: `p${i + 1}`,
    nome: `Notebook (${i + 1}/${quantidade})`,
    mes_referencia: adicionarMeses(mesInicio, i),
    valor_estimado: centavosParaReais(centavos),
    valor_real: null,
    tipo: 'despesa',
    categoria_id: 2,
    numero_parcela: i + 1,
    status_pagamento: status[i] === undefined ? 'pendente' : status[i],
    pago_em: status[i] === 'pago' ? '2026-10-05T12:00:00Z' : null,
  }))
}

describe('situacaoParcela', () => {
  const mesAtual = '2026-11'

  it('paga quando status = pago', () => {
    expect(situacaoParcela({ status_pagamento: 'pago', mes_referencia: '2026-01' }, mesAtual)).toBe('paga')
  })

  it('vencida somente quando pendente e o mês já terminou', () => {
    expect(situacaoParcela({ status_pagamento: 'pendente', mes_referencia: '2026-10' }, mesAtual)).toBe('vencida')
    expect(situacaoParcela({ status_pagamento: 'pendente', mes_referencia: '2026-11' }, mesAtual)).toBe('pendente')
    expect(situacaoParcela({ status_pagamento: 'pendente', mes_referencia: '2027-01' }, mesAtual)).toBe('pendente')
  })

  it('registro antigo (NULL) nunca é presumido pago nem vencido', () => {
    expect(situacaoParcela({ status_pagamento: null, mes_referencia: '2020-01' }, mesAtual)).toBe('sem_status')
  })
})

describe('resumirParcelamento', () => {
  it('parcelamento novo: nada pago, soma igual ao total', () => {
    const resumo = resumirParcelamento({ parcelas: criarParcelas(10000, 3, '2026-11') }, '2026-11')

    expect(resumo.totalParcelas).toBe(3)
    expect(resumo.pagas).toBe(0)
    expect(resumo.pendentes).toBe(3)
    expect(resumo.valorTotalCentavos).toBe(10000)
    expect(resumo.valorRestanteCentavos).toBe(10000)
    expect(resumo.valorParcelaCentavos).toBe(3334)
    expect(resumo.valoresDiferentes).toBe(true)
    expect(resumo.proxima?.numero_parcela).toBe(1)
    expect(resumo.progresso).toBe(0)
    expect(resumo.finalizado).toBe(false)
  })

  it('pagamentos parciais atualizam restante, próxima e progresso', () => {
    const parcelas = criarParcelas(10000, 3, '2026-10', ['pago'])
    const resumo = resumirParcelamento({ parcelas }, '2026-11')

    expect(resumo.pagas).toBe(1)
    expect(resumo.pendentes).toBe(2)
    expect(resumo.valorPagoCentavos).toBe(3334)
    expect(resumo.valorRestanteCentavos).toBe(6666)
    expect(resumo.proxima?.numero_parcela).toBe(2)
    expect(resumo.valorParcelaCentavos).toBe(3333)
    expect(resumo.progresso).toBe(33)
  })

  it('próxima parcela é a primeira não paga, mesmo fora de ordem', () => {
    const parcelas = criarParcelas(40000, 4, '2026-09', ['pago', 'pendente', 'pago', 'pendente'])
    const resumo = resumirParcelamento({ parcelas: [...parcelas].reverse() }, '2026-12')

    expect(resumo.proxima?.numero_parcela).toBe(2)
    expect(resumo.vencidas).toBe(1)
  })

  it('finalizado quando todas as parcelas estão pagas', () => {
    const parcelas = criarParcelas(30000, 3, '2026-01', ['pago', 'pago', 'pago'])
    const resumo = resumirParcelamento({ parcelas }, '2026-11')

    expect(resumo.finalizado).toBe(true)
    expect(resumo.progresso).toBe(100)
    expect(resumo.valorRestanteCentavos).toBe(0)
    expect(resumo.proxima).toBeNull()
  })

  it('registros antigos ficam como "sem status" e contam como não pagos', () => {
    const parcelas = criarParcelas(60000, 6, '2025-01', [null, null, null, null, null, null])
    const resumo = resumirParcelamento({ parcelas }, '2026-11')

    expect(resumo.semStatus).toBe(6)
    expect(resumo.vencidas).toBe(0)
    expect(resumo.pagas).toBe(0)
    expect(resumo.finalizado).toBe(false)
  })

  it('após excluir uma parcela, o total reflete apenas as restantes', () => {
    const parcelas = criarParcelas(10000, 3, '2026-11').filter((p) => p.numero_parcela !== 2)
    const resumo = resumirParcelamento({ parcelas }, '2026-11')

    expect(resumo.totalParcelas).toBe(2)
    expect(resumo.valorTotalCentavos).toBe(6667)
  })

  it('soma de valores em reais não sofre erro de ponto flutuante', () => {
    // 0,1 + 0,2 em reais
    const parcelas = criarParcelas(30, 2, '2026-11')
    parcelas[0].valor_estimado = 0.1
    parcelas[1].valor_estimado = 0.2

    expect(resumirParcelamento({ parcelas }, '2026-11').valorTotalCentavos).toBe(30)
  })

  it('valor contratado é preservado separado da soma das parcelas', () => {
    // Caso real: contratado R$ 548,46, parcelas editadas somam R$ 545,28
    const parcelas = criarParcelas(54846, 2, '2026-10', [null, null])
    parcelas[0].valor_estimado = 274.23
    parcelas[1].valor_estimado = 271.05

    const resumo = resumirParcelamento({ parcelas, valor_contratado: 548.46 }, '2026-11')

    expect(resumo.valorContratadoCentavos).toBe(54846)
    expect(resumo.valorTotalCentavos).toBe(54528)
    expect(resumo.diferencaContratadoCentavos).toBe(318)
  })

  it('sem divergência quando as parcelas somam o contratado', () => {
    const resumo = resumirParcelamento(
      { parcelas: criarParcelas(10000, 3, '2026-11'), valor_contratado: 100 },
      '2026-11'
    )
    expect(resumo.diferencaContratadoCentavos).toBe(0)
  })

  it('sem valor contratado informado, a diferença é desconhecida', () => {
    const resumo = resumirParcelamento({ parcelas: criarParcelas(10000, 3, '2026-11') }, '2026-11')
    expect(resumo.valorContratadoCentavos).toBeNull()
    expect(resumo.diferencaContratadoCentavos).toBeNull()
  })

  it('parcelamento sem parcelas não é finalizado', () => {
    const resumo = resumirParcelamento({ parcelas: [] }, '2026-11')
    expect(resumo.finalizado).toBe(false)
    expect(resumo.progresso).toBe(0)
  })
})

describe('edição "esta e as próximas"', () => {
  it('não inclui parcelas anteriores nem parcelas pagas', () => {
    const parcelas = criarParcelas(60000, 6, '2026-08', ['pago', 'pago', 'pendente', 'pago', 'pendente', null])
    const afetadas = parcelasAfetadasPorEdicaoFutura(parcelas, 3).map((p) => p.numero_parcela)

    expect(afetadas).toEqual([3, 5, 6])
  })
})

describe('agruparParcelasPorAno', () => {
  it('agrupa e ordena por mês', () => {
    const grupos = agruparParcelasPorAno(criarParcelas(50000, 5, '2026-10').reverse())

    expect(grupos.map((g) => g.ano)).toEqual(['2026', '2027'])
    expect(grupos[0].parcelas.map((p) => p.mes_referencia)).toEqual(['2026-10', '2026-11', '2026-12'])
    expect(grupos[1].parcelas.map((p) => p.mes_referencia)).toEqual(['2027-01', '2027-02'])
  })
})

describe('nomeBaseParcela', () => {
  it('remove o sufixo de numeração', () => {
    expect(nomeBaseParcela('Notebook (3/12)')).toBe('Notebook')
    expect(nomeBaseParcela('TV (1/2) ')).toBe('TV')
    expect(nomeBaseParcela('Curso (online)')).toBe('Curso (online)')
  })
})
