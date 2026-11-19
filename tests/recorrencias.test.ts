import { describe, expect, it } from 'vitest'
import {
  adicionarDias,
  adicionarMesesData,
  dataValida,
  descreverPrazo,
  diferencaDias,
  fimDoMes,
  formatarData,
  formatarDataCurta,
  hoje,
  nomeDiaSemana,
} from '../app/lib/datas'
import {
  RegraRecorrencia,
  dataOcorrencia,
  descreverFrequencia,
  ocorrenciasEntre,
  proximaOcorrencia,
} from '../app/lib/recorrencias'

const regra = (r: Partial<RegraRecorrencia> = {}): RegraRecorrencia => ({
  frequencia: 'mensal',
  intervalo: 1,
  data_inicio: '2026-11-10',
  data_fim: null,
  ...r,
})

describe('datas', () => {
  it('soma meses ajustando meses curtos sem acumular o ajuste', () => {
    expect(adicionarMesesData('2027-01-31', 1)).toBe('2027-02-28')
    expect(adicionarMesesData('2027-01-31', 2)).toBe('2027-03-31')
    expect(adicionarMesesData('2028-01-31', 1)).toBe('2028-02-29')
    expect(adicionarMesesData('2026-11-15', 14)).toBe('2028-01-15')
    expect(adicionarMesesData('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('soma dias atravessando meses e anos', () => {
    expect(adicionarDias('2026-12-28', 7)).toBe('2027-01-04')
    expect(adicionarDias('2028-02-28', 1)).toBe('2028-02-29')
    expect(diferencaDias('2026-11-01', '2026-12-01')).toBe(30)
  })

  it('valida e formata', () => {
    expect(dataValida('2026-02-29')).toBe(false)
    expect(dataValida('2028-02-29')).toBe(true)
    expect(dataValida('2026-13-01')).toBe(false)
    expect(formatarData('2026-11-05')).toBe('05/11/2026')
    expect(formatarDataCurta('2026-11-05')).toBe('5 nov.')
    expect(fimDoMes('2028-02')).toBe('2028-02-29')
    expect(nomeDiaSemana('2026-11-18')).toBe('quarta')
  })

  it('hoje no fuso de Brasília, independente do servidor', () => {
    // 2026-11-19 01:30 UTC = 2026-11-18 22:30 em Brasília
    expect(hoje('America/Sao_Paulo', new Date('2026-11-19T01:30:00Z'))).toBe('2026-11-18')
    expect(hoje('UTC', new Date('2026-11-19T01:30:00Z'))).toBe('2026-11-19')
  })

  it('descreve prazos', () => {
    expect(descreverPrazo('2026-11-18', '2026-11-18')).toBe('hoje')
    expect(descreverPrazo('2026-11-19', '2026-11-18')).toBe('amanhã')
    expect(descreverPrazo('2026-11-25', '2026-11-18')).toBe('em 7 dias')
    expect(descreverPrazo('2026-11-15', '2026-11-18')).toBe('há 3 dias')
  })
})

describe('recorrências (mesmos casos dos testes SQL)', () => {
  it('mensal a partir do início, com mês curto', () => {
    expect(ocorrenciasEntre(regra({ data_inicio: '2027-01-31' }), '2027-01-01', '2027-05-31')).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31',
    ])
  })

  it('anual em 29/02', () => {
    expect(ocorrenciasEntre(regra({ frequencia: 'anual', data_inicio: '2028-02-29' }), '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29',
    ])
  })

  it('semanal, quinzenal e bimestral', () => {
    expect(ocorrenciasEntre(regra({ frequencia: 'semanal', data_inicio: '2026-11-02' }), '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
    ])
    expect(ocorrenciasEntre(regra({ frequencia: 'semanal', intervalo: 2, data_inicio: '2026-11-01' }), '2026-11-01', '2026-12-01')).toEqual([
      '2026-11-01', '2026-11-15', '2026-11-29',
    ])
    expect(ocorrenciasEntre(regra({ intervalo: 2, data_inicio: '2026-11-05' }), '2026-11-01', '2027-06-30')).toEqual([
      '2026-11-05', '2027-01-05', '2027-03-05', '2027-05-05',
    ])
  })

  it('respeita data final e intervalo de consulta', () => {
    expect(ocorrenciasEntre(regra({ data_fim: '2027-01-15' }), '2026-01-01', '2027-12-31')).toEqual([
      '2026-11-10', '2026-12-10', '2027-01-10',
    ])
    expect(ocorrenciasEntre(regra(), '2026-12-11', '2027-02-10')).toEqual(['2027-01-10', '2027-02-10'])
  })

  it('próxima ocorrência', () => {
    expect(proximaOcorrencia(regra(), '2026-11-10')).toBe('2026-11-10')
    expect(proximaOcorrencia(regra(), '2026-11-11')).toBe('2026-12-10')
    expect(proximaOcorrencia(regra({ data_fim: '2026-12-01' }), '2026-11-11')).toBeNull()
    expect(proximaOcorrencia({ ...regra(), status: 'pausada' }, '2026-11-01')).toBeNull()
  })

  it('n-ésima data nunca acumula ajuste de mês curto', () => {
    const r = regra({ data_inicio: '2027-01-31' })
    expect([0, 1, 2, 3, 13].map((n) => dataOcorrencia(r, n))).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2028-02-29',
    ])
  })

  it('descreve a frequência em português', () => {
    expect(descreverFrequencia(regra())).toBe('Mensal · todo dia 10')
    expect(descreverFrequencia(regra({ intervalo: 3 }))).toBe('A cada 3 meses · todo dia 10')
    expect(descreverFrequencia(regra({ frequencia: 'semanal', data_inicio: '2026-11-18' }))).toBe('Semanal · às quartas')
    expect(descreverFrequencia(regra({ frequencia: 'semanal', intervalo: 2, data_inicio: '2026-11-22' }))).toBe('A cada 2 semanas · aos domingos')
    expect(descreverFrequencia(regra({ frequencia: 'anual', data_inicio: '2026-03-15' }))).toBe('Anual · 15 mar.')
  })
})

describe('horizonte de geração e equivalente mensal', () => {
  it('gera pelo menos 3 meses à frente e até o mês visualizado', async () => {
    const { horizonteGeracao, valorMensalEquivalenteCentavos } = await import('../app/lib/recorrencias')
    expect(horizonteGeracao('2026-11', '2026-11-18')).toBe('2027-02-28')
    expect(horizonteGeracao('2027-08', '2026-11-18')).toBe('2027-08-31')
    expect(horizonteGeracao('2026-01', '2026-11-18')).toBe('2027-02-28')
    expect(horizonteGeracao('2050-01', '2026-11-18')).toBe('2036-11-18')

    expect(valorMensalEquivalenteCentavos({ frequencia: 'mensal', intervalo: 1 }, 5000)).toBe(5000)
    expect(valorMensalEquivalenteCentavos({ frequencia: 'mensal', intervalo: 2 }, 5000)).toBe(2500)
    expect(valorMensalEquivalenteCentavos({ frequencia: 'semanal', intervalo: 1 }, 1200)).toBe(5200)
    expect(valorMensalEquivalenteCentavos({ frequencia: 'anual', intervalo: 1 }, 120000)).toBe(10000)
  })
})
