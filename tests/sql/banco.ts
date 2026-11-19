/*
 * Infraestrutura dos testes SQL: um Postgres real (PGlite, em WASM) com
 * o esquema base espelhado do Supabase + todas as migrations do projeto,
 * aplicadas em ordem, cada uma em uma transação (como o apply_migration).
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..', '..')
const PASTA_MIGRATIONS = join(RAIZ, 'supabase', 'migrations')

export const USUARIO_A = '11111111-1111-1111-1111-111111111111'
export const USUARIO_B = '22222222-2222-2222-2222-222222222222'

export function listarMigrations(): string[] {
  return readdirSync(PASTA_MIGRATIONS)
    .filter((arquivo) => arquivo.endsWith('.sql'))
    .sort()
}

export function lerMigration(arquivo: string): string {
  return readFileSync(join(PASTA_MIGRATIONS, arquivo), 'utf8')
}

export async function aplicar(db: PGlite, sql: string) {
  try {
    await db.exec(`begin;\n${sql}\ncommit;`)
  } catch (erro) {
    await db.exec('rollback;')
    throw erro
  }
}

export interface Banco {
  db: PGlite
  /** Executa como usuário autenticado (RLS ativo). null = anon. */
  como<T>(usuario: string | null, fn: () => Promise<T>): Promise<T>
  q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Executa como `usuario` e retorna as linhas. */
  qComo<T = Record<string, unknown>>(usuario: string | null, sql: string, params?: unknown[]): Promise<T[]>
  /** Retorna a mensagem de erro (com código) ou null se não falhar. */
  erro(fn: () => Promise<unknown>): Promise<string | null>
}

/**
 * Cria um banco com o esquema base, dados opcionais e as migrations até
 * `ate` (inclusive; por padrão, todas).
 */
async function montarBanco(opcoes: { dadosAntes?: string; ate?: string }): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join(__dirname, 'esquema-base.sql'), 'utf8'))
  await db.exec(`insert into auth.users values ('${USUARIO_A}'), ('${USUARIO_B}');`)

  if (opcoes.dadosAntes) await db.exec(opcoes.dadosAntes)

  for (const arquivo of listarMigrations()) {
    await aplicar(db, lerMigration(arquivo))
    if (opcoes.ate && arquivo.startsWith(opcoes.ate)) break
  }

  return db
}

// Banco padrão (sem dados prévios, todas as migrations) montado uma vez
// por arquivo de teste e clonado a partir de um dump: bem mais rápido.
let modeloPadrao: Promise<Blob> | null = null

async function clonarPadrao(): Promise<PGlite> {
  modeloPadrao ??= montarBanco({}).then(async (db) => {
    const dump = await db.dumpDataDir('none')
    await db.close()
    return dump
  })

  return new PGlite({ loadDataDir: await modeloPadrao })
}

export async function criarBanco(
  opcoes: { dadosAntes?: string; ate?: string } = {}
): Promise<Banco> {
  const db = opcoes.dadosAntes || opcoes.ate ? await montarBanco(opcoes) : await clonarPadrao()

  const q = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows

  const como = async <T,>(usuario: string | null, fn: () => Promise<T>) => {
    await db.exec(
      `select set_config('request.jwt.claim.sub', '${usuario ?? ''}', false); set role ${usuario ? 'authenticated' : 'anon'};`
    )
    try {
      return await fn()
    } finally {
      await db.exec('reset role;')
    }
  }

  return {
    db,
    como,
    q,
    qComo: (usuario, sql, params) => como(usuario, () => q(sql, params)),
    erro: async (fn) => {
      try {
        await fn()
        return null
      } catch (e) {
        const err = e as { code?: string; message?: string }
        return `${err.code ?? ''} ${err.message ?? String(e)}`
      }
    },
  }
}
