import { supabase } from './supabase'
import type { Agreement, Debt, MonthlySummary, ProcessOperation, Recurring, SavingEvent, SavingsSummary, Transaction } from './types'
import { addMonths, firstDayOfMonth, lastDayOfMonth } from './format'

export async function fetchMonthlySummary(orgId: string, fromMonth: string, toMonth: string) {
  const { data, error } = await supabase
    .from('v_monthly_summary')
    .select('*')
    .eq('org_id', orgId)
    .gte('month', fromMonth)
    .lte('month', toMonth)
  if (error) throw error
  return (data as MonthlySummary[]).map(r => ({
    ...r,
    income: Number(r.income), expense: Number(r.expense),
    fixed_cost: Number(r.fixed_cost), debt_service: Number(r.debt_service), tx_count: Number(r.tx_count),
  }))
}

export async function fetchTransactions(orgId: string, opts: {
  month?: string; entityId?: string | null; accountId?: string | null; search?: string;
  uncategorized?: boolean; limit?: number; from?: string; to?: string
}) {
  let q = supabase.from('transactions').select('*').eq('org_id', orgId).order('posted_at', { ascending: false }).order('id', { ascending: false })
  if (opts.month) q = q.gte('posted_at', firstDayOfMonth(opts.month)).lte('posted_at', lastDayOfMonth(opts.month))
  if (opts.from) q = q.gte('posted_at', opts.from)
  if (opts.to) q = q.lte('posted_at', opts.to)
  if (opts.entityId) q = q.eq('entity_id', opts.entityId)
  if (opts.accountId) q = q.eq('account_id', opts.accountId)
  if (opts.uncategorized) q = q.is('category_id', null).eq('is_transfer', false)
  if (opts.search) q = q.ilike('description', `%${opts.search}%`)
  q = q.limit(opts.limit ?? 500)
  const { data, error } = await q
  if (error) throw error
  return (data as Transaction[]).map(t => ({ ...t, amount: Number(t.amount), balance_after: t.balance_after === null ? null : Number(t.balance_after) }))
}

export async function fetchRecurring(orgId: string, entityId?: string | null) {
  let q = supabase.from('v_recurring').select('*').eq('org_id', orgId).order('monthly_equivalent', { ascending: false, nullsFirst: false })
  if (entityId) q = q.eq('entity_id', entityId)
  const { data, error } = await q
  if (error) throw error
  return (data as Recurring[]).map(r => ({
    ...r,
    expected_amount: r.expected_amount === null ? null : Number(r.expected_amount),
    avg_amount: r.avg_amount == null ? null : Number(r.avg_amount),
    last_amount: r.last_amount == null ? null : Number(r.last_amount),
    monthly_equivalent: r.monthly_equivalent == null ? null : Number(r.monthly_equivalent),
    months_seen: Number(r.months_seen ?? 0),
  }))
}

export async function fetchDebts(orgId: string, entityId?: string | null) {
  let q = supabase.from('v_debts').select('*').eq('org_id', orgId).order('remaining_est', { ascending: false })
  if (entityId) q = q.eq('entity_id', entityId)
  const { data, error } = await q
  if (error) throw error
  return (data as Debt[]).map(d => ({
    ...d,
    principal: d.principal == null ? null : Number(d.principal),
    installment_amount: d.installment_amount == null ? null : Number(d.installment_amount),
    annual_rate: d.annual_rate == null ? null : Number(d.annual_rate),
    balance_manual: d.balance_manual == null ? null : Number(d.balance_manual),
    paid_before_tracking: Number(d.paid_before_tracking),
    paid_total: Number(d.paid_total ?? 0),
    remaining_est: d.remaining_est == null ? null : Number(d.remaining_est),
    monthly_interest_est: d.monthly_interest_est == null ? null : Number(d.monthly_interest_est),
    monthly_payment: d.monthly_payment == null ? null : Number(d.monthly_payment),
  }))
}

export function monthsBack(month: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(month, -i))
  return out
}

export interface CategoryMonth {
  category_id: string | null; category_name: string | null; category_kind: string | null
  is_fixed: boolean; is_variable: boolean; total: number; n: number
}

export async function fetchCategoryMonth(orgId: string, month: string, entityId?: string | null): Promise<CategoryMonth[]> {
  let q = supabase.from('v_category_month').select('category_id, category_name, category_kind, is_fixed, is_variable, total, n, entity_id').eq('org_id', orgId).eq('month', month)
  if (entityId) q = q.eq('entity_id', entityId)
  const { data, error } = await q
  if (error) throw error
  // sumar entre entidades
  const map = new Map<string, CategoryMonth>()
  for (const r of (data ?? []) as (CategoryMonth & { entity_id: string })[]) {
    const k = r.category_id ?? '__none'
    const cur = map.get(k)
    if (cur) { cur.total += Number(r.total); cur.n += Number(r.n) }
    else map.set(k, { category_id: r.category_id, category_name: r.category_name, category_kind: r.category_kind, is_fixed: r.is_fixed, is_variable: r.is_variable, total: Number(r.total), n: Number(r.n) })
  }
  return [...map.values()]
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function fetchSavings(orgId: string) {
  const { data, error } = await supabase.from('v_savings').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
  if (error) throw error
  return (data as SavingEvent[]).map(s => ({
    ...s,
    amount_before: num(s.amount_before), amount_after_expected: Number(s.amount_after_expected ?? 0),
    amount_after_actual: num(s.amount_after_actual), monthly_saving: num(s.monthly_saving),
    commission_pct: Number(s.commission_pct), commission_amount: num(s.commission_amount),
    rate_before: num(s.rate_before), rate_after: num(s.rate_after), volume_units: num(s.volume_units),
    ops_total: Number(s.ops_total ?? 0), ops_linked: Number(s.ops_linked ?? 0),
  }))
}

export async function fetchSavingsSummary(orgId: string): Promise<SavingsSummary | null> {
  const { data, error } = await supabase.from('v_savings_summary').select('*').eq('org_id', orgId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const d = data as SavingsSummary
  return {
    ...d,
    pendientes: Number(d.pendientes), verificados: Number(d.verificados), no_logrados: Number(d.no_logrados),
    ahorro_mensual_total: Number(d.ahorro_mensual_total), ahorro_proyectado_12m: Number(d.ahorro_proyectado_12m),
    comision_devengada: Number(d.comision_devengada), comision_pagada: Number(d.comision_pagada),
  }
}

export async function fetchAgreement(orgId: string): Promise<Agreement | null> {
  const { data, error } = await supabase.from('agreements').select('*').eq('org_id', orgId).eq('kind', 'ahorro_compartido').maybeSingle()
  if (error) throw error
  return data ? { ...(data as Agreement), commission_pct: Number((data as Agreement).commission_pct) } : null
}

export async function fetchProcessOperations(savingId: string) {
  const { data, error } = await supabase.from('process_operations').select('*').eq('saving_id', savingId).order('phase').order('op_date')
  if (error) throw error
  return (data as ProcessOperation[]).map(o => ({ ...o, clp_amount: Number(o.clp_amount), units: Number(o.units) }))
}
