import { beforeEach, describe, expect, it } from 'vitest'
import { Banco, USUARIO_A as A, USUARIO_B as B, criarBanco } from './banco'

interface Ocorrencia {
  id: string
  nome: string
  data_vencimento: string
  mes_referencia: string
  valor_estimado: string
  status_pagamento: string | null
  categoria_id: number | null
}

const fixarHoje = (b: Banco, data: string) => b.db.exec(`select set_config('app.hoje', '${data}', false)`)

async function criarRecorrencia(
  b: Banco,
  usuario: string,
  campos: Partial<{ nome: string; tipo: string; categoria: number | null; valor: number; frequencia: string; intervalo: number; inicio: string; fim: string | null; ate: string }> = {}
): Promise<string> {
  const c = { nome: 'Barbeiro', tipo: 'despesa', categoria: 2, valor: 50, frequencia: 'mensal', intervalo: 1, inicio: '2026-11-10', fim: null, ate: '2027-02-28', ...campos }
  const [{ id }] = await b.qComo<{ id: string }>(usuario,
    `select criar_recorrencia($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9::date) as id`,
    [c.nome, c.tipo, c.categoria, c.valor, c.frequencia, c.intervalo, c.inicio, c.fim, c.ate])
  return id
}

const ocorrencias = (b: Banco, id: string) =>
  b.q<Ocorrencia>(
    `select id, nome, to_char(data_vencimento, 'YYYY-MM-DD') data_vencimento, mes_referencia, valor_estimado, status_pagamento, categoria_id
       from transacoes where recorrencia_id = $1 order by data_vencimento`, [id])

const datas = async (b: Banco, id: string) => (await ocorrencias(b, id)).map((o) => o.data_vencimento)

describe('FASE 2 — geração de ocorrências', () => {
  let b: Banco

  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-11-18')
  })

  it('gera ocorrências mensais até a data limite, pendentes e com mês correto', async () => {
    const id = await criarRecorrencia(b, A)
    const lista = await ocorrencias(b, id)
    expect(lista.map((o) => o.data_vencimento)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10'])
    expect(lista.map((o) => o.mes_referencia)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(lista.every((o) => o.status_pagamento === 'pendente' && Number(o.valor_estimado) === 50 && o.categoria_id === 2)).toBe(true)
  })

  it('não duplica ao gerar várias vezes (idempotente)', async () => {
    const id = await criarRecorrencia(b, A)
    for (let i = 0; i < 3; i++) {
      const [{ n }] = await b.qComo<{ n: number }>(A, `select gerar_ocorrencias('2027-02-28') as n`)
      expect(n).toBe(0)
    }
    expect((await ocorrencias(b, id)).length).toBe(4)
  })

  it('recupera meses sem acesso ao gerar com data limite maior', async () => {
    const id = await criarRecorrencia(b, A, { ate: '2026-11-30' })
    expect((await ocorrencias(b, id)).length).toBe(1)
    await fixarHoje(b, '2027-05-02')
    const [{ n }] = await b.qComo<{ n: number }>(A, `select gerar_ocorrencias('2027-05-31') as n`)
    expect(n).toBe(6)
    expect(await datas(b, id)).toEqual([
      '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10',
    ])
  })

  it('dia 31 respeita meses curtos sem "encolher" a data', async () => {
    const id = await criarRecorrencia(b, A, { inicio: '2027-01-31', ate: '2027-05-31' })
    expect(await datas(b, id)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'])
  })

  it('29/02 anual cai em 28/02 nos anos não bissextos', async () => {
    const id = await criarRecorrencia(b, A, { frequencia: 'anual', inicio: '2028-02-29', ate: '2032-12-31' })
    expect(await datas(b, id)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  })

  it('semanal e "a cada N" (personalizada)', async () => {
    const semanal = await criarRecorrencia(b, A, { frequencia: 'semanal', inicio: '2026-11-02', ate: '2026-11-30' })
    expect(await datas(b, semanal)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])

    const bimestral = await criarRecorrencia(b, A, { intervalo: 2, inicio: '2026-11-05', ate: '2027-06-30' })
    expect(await datas(b, bimestral)).toEqual(['2026-11-05', '2027-01-05', '2027-03-05', '2027-05-05'])

    const quinzenal = await criarRecorrencia(b, A, { frequencia: 'semanal', intervalo: 2, inicio: '2026-11-01', ate: '2026-12-01' })
    expect(await datas(b, quinzenal)).toEqual(['2026-11-01', '2026-11-15', '2026-11-29'])
  })

  it('respeita a data final', async () => {
    const id = await criarRecorrencia(b, A, { fim: '2027-01-15', ate: '2027-12-31' })
    expect(await datas(b, id)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10'])
  })

  it('ocorrência excluída individualmente não volta a ser gerada', async () => {
    const id = await criarRecorrencia(b, A)
    const [dez] = (await ocorrencias(b, id)).filter((o) => o.data_vencimento === '2026-12-10')
    await b.qComo(A, `delete from transacoes where id = $1`, [dez.id])
    await b.qComo(A, `select gerar_ocorrencias('2027-03-31')`)
    expect(await datas(b, id)).toEqual(['2026-11-10', '2027-01-10', '2027-02-10', '2027-03-10'])
  })

  it('receita recorrente não recebe categoria', async () => {
    const id = await criarRecorrencia(b, A, { nome: 'Salário', tipo: 'receita', categoria: 1, valor: 2500, inicio: '2026-11-05' })
    expect((await ocorrencias(b, id)).every((o) => o.categoria_id === null)).toBe(true)
  })

  it('valida entradas', async () => {
    expect(await b.erro(() => criarRecorrencia(b, A, { valor: 0 }))).toMatch(/valor/)
    expect(await b.erro(() => criarRecorrencia(b, A, { valor: 10.555 }))).toMatch(/valor/)
    expect(await b.erro(() => criarRecorrencia(b, A, { frequencia: 'diaria' }))).toMatch(/Frequência/)
    expect(await b.erro(() => criarRecorrencia(b, A, { intervalo: 0 }))).toMatch(/intervalo/)
    expect(await b.erro(() => criarRecorrencia(b, A, { fim: '2026-01-01' }))).toMatch(/data final/)
    expect(await b.erro(() => criarRecorrencia(b, A, { nome: '  ' }))).toMatch(/nome/)
  })
})

describe('FASE 2 — gerenciamento sem alterar o histórico', () => {
  let b: Banco

  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-12-15')
  })

  it('editar altera só futuras pendentes não editadas individualmente', async () => {
    const id = await criarRecorrencia(b, A, { inicio: '2026-10-10', ate: '2027-03-31' })
    const lista = await ocorrencias(b, id)
    // out/2026 paga; fev/2027 editada individualmente
    await b.qComo(A, `update transacoes set status_pagamento = 'pago', pago_em = now() where id = $1`, [lista[0].id])
    await b.qComo(A, `update transacoes set valor_estimado = 80 where id = $1`, [lista[4].id])

    const [{ n }] = await b.qComo<{ n: number }>(A,
      `select editar_recorrencia($1, 'Barbeiro novo', 60, 3, null) as n`, [id])
    expect(n).toBe(3) // 2026-12-10 é passado (hoje = 15/12); jan, fev, mar são futuras

    const depois = await ocorrencias(b, id)
    const porData = Object.fromEntries(depois.map((o) => [o.data_vencimento, o]))
    expect(Number(porData['2026-10-10'].valor_estimado)).toBe(50) // paga: intacta
    expect(porData['2026-10-10'].nome).toBe('Barbeiro')
    expect(Number(porData['2026-11-10'].valor_estimado)).toBe(50) // passada: intacta
    expect(Number(porData['2026-12-10'].valor_estimado)).toBe(50) // passada: intacta
    expect(Number(porData['2027-01-10'].valor_estimado)).toBe(60)
    expect(porData['2027-01-10'].nome).toBe('Barbeiro novo')
    expect(porData['2027-01-10'].categoria_id).toBe(3)
    expect(Number(porData['2027-02-10'].valor_estimado)).toBe(80) // editada à mão: preservada
    expect(porData['2027-02-10'].nome).toBe('Barbeiro novo')     // mas o nome (não editado) muda

    // Novas ocorrências usam os valores novos
    await b.qComo(A, `select gerar_ocorrencias('2027-04-30')`)
    const abr = (await ocorrencias(b, id)).find((o) => o.data_vencimento === '2027-04-10')!
    expect(Number(abr.valor_estimado)).toBe(60)
  })

  it('editar com data final mais cedo remove só futuras pendentes', async () => {
    const id = await criarRecorrencia(b, A, { inicio: '2026-10-10', ate: '2027-06-30' })
    await b.qComo(A, `select editar_recorrencia($1, 'Barbeiro', 50, 2, '2027-02-01')`, [id])
    expect(await datas(b, id)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10'])
    await b.qComo(A, `select gerar_ocorrencias('2027-12-31')`)
    expect((await ocorrencias(b, id)).length).toBe(4)
  })

  it('pausar e reativar pulam o período pausado', async () => {
    const id = await criarRecorrencia(b, A, { inicio: '2026-10-10', ate: '2027-03-31' })
    await b.qComo(A, `select pausar_recorrencia($1)`, [id])
    expect(await datas(b, id)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10'])

    // pausada não gera
    await b.qComo(A, `select gerar_ocorrencias('2027-06-30')`)
    expect((await ocorrencias(b, id)).length).toBe(3)

    await fixarHoje(b, '2027-02-20')
    await b.qComo(A, `select reativar_recorrencia($1, '2027-04-30')`, [id])
    expect(await datas(b, id)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10', '2027-03-10', '2027-04-10'])
  })

  it('encerrar preserva o histórico e remove futuras pendentes', async () => {
    const id = await criarRecorrencia(b, A, { inicio: '2026-10-10', ate: '2027-03-31' })
    await b.qComo(A, `select encerrar_recorrencia($1)`, [id])
    expect(await datas(b, id)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10'])
    const [r] = await b.q<{ status: string; data_fim: string }>(
      `select status, to_char(data_fim, 'YYYY-MM-DD') data_fim from recorrencias where id = $1`, [id])
    expect(r).toEqual({ status: 'encerrada', data_fim: '2026-12-15' })
    expect(await b.erro(() => b.qComo(A, `select encerrar_recorrencia($1)`, [id]))).toMatch(/já está encerrada/)
  })

  it('excluir a recorrência mantém passadas e pagas como transações comuns', async () => {
    const id = await criarRecorrencia(b, A, { inicio: '2026-10-10', ate: '2027-03-31' })
    const lista = await ocorrencias(b, id)
    await b.qComo(A, `update transacoes set status_pagamento = 'pago', pago_em = now() where id = $1`, [lista[5].id]) // mar/27 pago adiantado
    const [{ n }] = await b.qComo<{ n: number }>(A, `select excluir_recorrencia($1) as n`, [id])
    expect(n).toBe(2) // jan e fev pendentes futuras

    const restantes = await b.q<{ data_vencimento: string; recorrencia_id: string | null }>(
      `select to_char(data_vencimento, 'YYYY-MM-DD') data_vencimento, recorrencia_id from transacoes where nome = 'Barbeiro' order by 1`)
    expect(restantes.map((r) => r.data_vencimento)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10', '2027-03-10'])
    expect(restantes.every((r) => r.recorrencia_id === null)).toBe(true)
  })
})

describe('FASE 2 — isolamento e permissões', () => {
  let b: Banco

  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-11-18')
  })

  it('cada usuário só vê e gera as próprias recorrências', async () => {
    const idA = await criarRecorrencia(b, A)
    await criarRecorrencia(b, B, { nome: 'Academia', ate: '2026-11-30' })

    expect((await b.qComo(B, `select * from recorrencias`)).length).toBe(1)
    expect((await b.qComo(B, `select * from transacoes where recorrencia_id = $1`, [idA])).length).toBe(0)

    // B gerando não cria nada de A
    await b.qComo(B, `select gerar_ocorrencias('2027-12-31')`)
    expect((await ocorrencias(b, idA)).length).toBe(4)

    for (const rpc of ['pausar_recorrencia($1)', 'encerrar_recorrencia($1)', 'excluir_recorrencia($1)', `editar_recorrencia($1, 'x', 1, 1, null)`]) {
      expect(await b.erro(() => b.qComo(B, `select ${rpc}`, [idA]))).toMatch(/não encontrada/)
    }
  })

  it('B não consegue inserir recorrência em nome de A nem ligar ocorrência à recorrência de A', async () => {
    const idA = await criarRecorrencia(b, A)
    expect(await b.erro(() => b.qComo(B,
      `insert into recorrencias (usuario_id, nome, tipo, valor, frequencia, data_inicio) values ('${A}', 'x', 'despesa', 1, 'mensal', '2026-11-01')`))).toMatch(/row-level security/)
    expect(await b.erro(() => b.qComo(B,
      `insert into transacoes (usuario_id, nome, mes_referencia, valor_estimado, tipo, recorrencia_id, data_vencimento)
       values ('${B}', 'x', '2026-11', 1, 'despesa', '${idA}', '2026-11-30')`))).toMatch(/^23503/)
  })

  it('anon não acessa a tabela nem as funções', async () => {
    expect(await b.erro(() => b.qComo(null, `select * from recorrencias`))).toMatch(/permission denied/)
    expect(await b.erro(() => b.qComo(null, `select gerar_ocorrencias('2027-01-01')`))).toMatch(/permission denied/)
  })

  it('authenticated não pode truncar a tabela', async () => {
    expect(await b.erro(() => b.qComo(A, `truncate recorrencias`))).toMatch(/permission denied/)
  })
})

describe('FASE 2 — cancelar parcelas futuras', () => {
  let b: Banco

  beforeEach(async () => {
    b = await criarBanco()
    await fixarHoje(b, '2026-12-05')
  })

  it('remove só pendentes de meses futuros e preserva o contratado', async () => {
    const [{ id }] = await b.qComo<{ id: string }>(A,
      `select criar_parcelamento('Notebook', 'despesa', 2, '2026-11', array[100, 100, 100, 100, 100]::numeric[]) as id`)
    const ps = await b.q<{ id: string }>(`select id from transacoes where parcelamento_id = $1 order by numero_parcela`, [id])
    await b.qComo(A, `update transacoes set status_pagamento = 'pago', pago_em = now() where id = $1`, [ps[4].id]) // mar/27 paga adiantada

    const [{ n }] = await b.qComo<{ n: number }>(A, `select cancelar_parcelas_futuras($1) as n`, [id])
    expect(n).toBe(2) // jan e fev

    const restantes = await b.q<{ mes_referencia: string }>(
      `select mes_referencia from transacoes where parcelamento_id = $1 order by numero_parcela`, [id])
    expect(restantes.map((r) => r.mes_referencia)).toEqual(['2026-11', '2026-12', '2027-03'])
    const [p] = await b.q<{ total_parcelas: number; valor_total: string; valor_contratado: string }>(
      `select total_parcelas, valor_total, valor_contratado from parcelamentos where id = $1`, [id])
    expect(p.total_parcelas).toBe(3)
    expect(Number(p.valor_total)).toBe(300)
    expect(Number(p.valor_contratado)).toBe(500)

    expect(await b.erro(() => b.qComo(A, `select cancelar_parcelas_futuras($1)`, [id]))).toMatch(/Não há parcelas futuras/)
    expect(await b.erro(() => b.qComo(B, `select cancelar_parcelas_futuras($1)`, [id]))).toMatch(/não encontrado/)
  })

  it('bloqueia quando todas as parcelas são futuras', async () => {
    const [{ id }] = await b.qComo<{ id: string }>(A,
      `select criar_parcelamento('Sofá', 'despesa', 2, '2027-01', array[100, 100]::numeric[]) as id`)
    expect(await b.erro(() => b.qComo(A, `select cancelar_parcelas_futuras($1)`, [id]))).toMatch(/Exclua o parcelamento inteiro/)
  })
})
