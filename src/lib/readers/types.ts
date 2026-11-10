import type { AccountKind } from '../types'

export interface DraftRow {
  posted_at: string
  description: string
  amount: number
  meta?: Record<string, unknown>
  /** el signo o el monto se dedujo y conviene mirarlo */
  uncertain?: boolean
}

export type DocKind = 'cartola' | 'tarjeta' | 'cmf' | 'captura' | 'otro'

export interface ReadResult {
  /** cómo se leyó, en palabras simples */
  reader: string
  docKind: DocKind
  rows: DraftRow[]
  hint: { bank?: string; last4?: string; holder?: string; accountKind?: AccountKind; accountLabel?: string }
  /** cuadratura contra los saldos del propio archivo, cuando existe */
  check?: { ok: boolean; text: string }
  text: string
  warnings: string[]
}

export interface ReadOptions {
  onProgress?: (msg: string) => void
  askPassword?: (wrong: boolean) => string | null
}
