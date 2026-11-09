export type Role = 'owner' | 'admin' | 'viewer'

export interface Organization {
  id: string
  name: string
  slug: string
  baseline_month: string | null
  baseline_fixed_cost: number | null
  target_reduction_pct: number
}

export interface Entity {
  id: string
  org_id: string
  name: string
  kind: 'persona' | 'empresa'
  rut: string | null
  color_slot: number
  sort_order: number
}

export type AccountKind =
  | 'corriente' | 'vista' | 'ahorro' | 'tarjeta_credito' | 'linea_credito'
  | 'credito_consumo' | 'credito_comercial' | 'hipotecario' | 'leasing'
  | 'inversion' | 'efectivo' | 'billetera' | 'otro'

export interface Account {
  id: string
  org_id: string
  entity_id: string
  name: string
  bank: string
  kind: AccountKind
  currency: string
  last4: string | null
  credit_limit: number | null
  is_active: boolean
  import_mapping: ImportMapping | null
  notes: string | null
}

export type CategoryKind = 'ingreso' | 'gasto' | 'transferencia' | 'deuda' | 'inversion' | 'impuesto'

export interface Category {
  id: string
  org_id: string | null
  name: string
  kind: CategoryKind
  is_fixed: boolean
  exclude_from_recurring: boolean
  parent_id: string | null
  sort_order: number
}

export interface Transaction {
  id: number
  org_id: string
  account_id: string
  entity_id: string
  posted_at: string
  description: string
  description_norm: string
  amount: number
  balance_after: number | null
  category_id: string | null
  counterparty: string | null
  is_transfer: boolean
  recurring_id: string | null
  debt_id: string | null
  import_id: string | null
  fingerprint: string
  reviewed: boolean
  notes: string | null
}

export type RecurringStatus = 'revisar' | 'mantener' | 'negociar' | 'cancelar' | 'cancelado'
export type Cadence = 'semanal' | 'mensual' | 'bimestral' | 'trimestral' | 'anual' | 'irregular'

export interface Recurring {
  id: string
  org_id: string
  entity_id: string | null
  category_id: string | null
  name: string
  match_pattern: string
  cadence: Cadence
  expected_amount: number | null
  status: RecurringStatus
  decision_note: string | null
  first_seen: string | null
  last_seen: string | null
  cancelled_at: string | null
  // vista
  entity_name?: string | null
  category_name?: string | null
  months_seen?: number
  avg_amount?: number | null
  last_amount?: number | null
  monthly_equivalent?: number | null
}

export type DebtKind =
  | 'credito_consumo' | 'credito_comercial' | 'hipotecario' | 'linea_credito' | 'tarjeta_credito'
  | 'leasing' | 'factoring' | 'prestamo_persona' | 'proveedor' | 'sii' | 'otro'

export interface Debt {
  id: string
  org_id: string
  entity_id: string
  account_id: string | null
  creditor: string
  kind: DebtKind
  principal: number
  currency: string
  start_date: string | null
  installments_total: number | null
  installment_amount: number | null
  annual_rate: number | null
  balance_manual: number | null
  balance_manual_at: string | null
  paid_before_tracking: number
  status: 'activa' | 'pagada' | 'refinanciada' | 'en_mora'
  notes: string | null
  // vista
  entity_name?: string
  paid_total?: number
  payments_count?: number | null
  last_payment_at?: string | null
  remaining_est?: number
  monthly_interest_est?: number | null
  monthly_payment?: number | null
}

export interface DebtPayment {
  id: string
  debt_id: string
  org_id: string
  paid_at: string
  amount: number
  interest_part: number | null
  principal_part: number | null
  transaction_id: number | null
  notes: string | null
}

export interface Rule {
  id: string
  org_id: string
  pattern: string
  category_id: string | null
  entity_id: string | null
  counterparty: string | null
  recurring_id: string | null
  debt_id: string | null
  mark_transfer: boolean
  priority: number
  is_active: boolean
}

export interface MonthlySummary {
  org_id: string
  entity_id: string
  month: string
  income: number
  expense: number
  fixed_cost: number
  debt_service: number
  tx_count: number
}

export interface ImportMapping {
  date: string
  description: string
  /** una columna con signo, o dos columnas (cargo/abono) */
  amount?: string
  debit?: string
  credit?: string
  balance?: string
  /** 'dmy' | 'ymd' | 'mdy' */
  dateFormat: 'dmy' | 'ymd' | 'mdy'
  /** fila (0-based) donde están los encabezados */
  headerRow: number
  /** si los cargos vienen en positivo en la columna debit */
  debitIsPositive: boolean
}

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  corriente: 'Cuenta corriente',
  vista: 'Cuenta vista',
  ahorro: 'Cuenta de ahorro',
  tarjeta_credito: 'Tarjeta de crédito',
  linea_credito: 'Línea de crédito',
  credito_consumo: 'Crédito de consumo',
  credito_comercial: 'Crédito comercial',
  hipotecario: 'Crédito hipotecario',
  leasing: 'Leasing',
  inversion: 'Inversión',
  efectivo: 'Efectivo',
  billetera: 'Billetera digital',
  otro: 'Otro',
}

export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  credito_consumo: 'Crédito de consumo',
  credito_comercial: 'Crédito comercial',
  hipotecario: 'Hipotecario',
  linea_credito: 'Línea de crédito',
  tarjeta_credito: 'Tarjeta de crédito',
  leasing: 'Leasing',
  factoring: 'Factoring',
  prestamo_persona: 'Préstamo de persona',
  proveedor: 'Deuda con proveedor',
  sii: 'SII / impuestos',
  otro: 'Otro',
}

export const RECURRING_STATUS_LABEL: Record<RecurringStatus, string> = {
  revisar: 'Por revisar',
  mantener: 'Se mantiene',
  negociar: 'Negociar',
  cancelar: 'Cancelar',
  cancelado: 'Cancelado',
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  semanal: 'Semanal',
  mensual: 'Mensual',
  bimestral: 'Cada 2 meses',
  trimestral: 'Trimestral',
  anual: 'Anual',
  irregular: 'Irregular',
}

// ── Ahorro compartido ─────────────────────────────────────────────
export interface Agreement {
  id: string
  org_id: string
  kind: string
  commission_pct: number
  payout: 'unico' | 'recurrente'
  terms_md: string
  accepted_by: string | null
  accepted_email: string | null
  accepted_at: string | null
  created_at: string
}

export type SavingKind = 'cargo' | 'proceso'
export type SavingAction = 'cancelado' | 'renegociado' | 'rebajado' | 'cambio_proceso' | 'otro'
export type SavingStatus = 'pendiente' | 'verificado' | 'no_logrado' | 'reaparecio'
export type CommissionStatus = 'pendiente' | 'devengada' | 'pagada' | 'anulada'

export interface SavingEvent {
  id: string
  org_id: string
  agreement_id: string | null
  recurring_id: string | null
  entity_id: string | null
  account_id: string | null
  kind: SavingKind
  title: string
  action: SavingAction
  action_note: string | null
  amount_before: number | null
  amount_after_expected: number
  match_pattern: string | null
  window_start: string
  window_end: string
  grace_days: number
  status: SavingStatus
  amount_after_actual: number | null
  monthly_saving: number | null
  commission_pct: number
  commission_amount: number | null
  verified_at: string | null
  verification_detail: string | null
  reappeared_at: string | null
  commission_status: CommissionStatus
  commission_paid_at: string | null
  commission_payment_tx: number | null
  unit_label: string | null
  rate_before: number | null
  rate_after: number | null
  volume_units: number | null
  created_at: string
  // vista
  entity_name?: string | null
  ops_total?: number
  ops_linked?: number
}

export interface ProcessOperation {
  id: string
  org_id: string
  saving_id: string
  phase: 'antes' | 'despues'
  op_date: string
  clp_amount: number
  units: number
  reference: string | null
  account_id: string | null
  transaction_id: number | null
  notes: string | null
}

export interface SavingsSummary {
  org_id: string
  pendientes: number
  verificados: number
  no_logrados: number
  ahorro_mensual_total: number
  ahorro_proyectado_12m: number
  comision_devengada: number
  comision_pagada: number
}

export const SAVING_ACTION_LABEL: Record<SavingAction, string> = {
  cancelado: 'Cancelado',
  renegociado: 'Renegociado',
  rebajado: 'Rebajado',
  cambio_proceso: 'Cambio de proceso',
  otro: 'Otro',
}

export const SAVING_STATUS_LABEL: Record<SavingStatus, string> = {
  pendiente: 'Esperando cartola',
  verificado: 'Verificado',
  no_logrado: 'No logrado',
  reaparecio: 'Verificado · reapareció',
}

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pendiente: 'Aún no corresponde',
  devengada: 'Por pagar',
  pagada: 'Pagada',
  anulada: 'Anulada',
}
