import { supabase } from './supabase'
import type { Debt, MonthlySummary, Recurring, Transaction } from './types'
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
    principal: Number(d.principal),
    installment_amount: d.installment_amount == null ? null : Number(d.installment_amount),
    annual_rate: d.annual_rate == null ? null : Number(d.annual_rate),
    balance_manual: d.balance_manual == null ? null : Number(d.balance_manual),
    paid_before_tracking: Number(d.paid_before_tracking),
    paid_total: Number(d.paid_total ?? 0),
    remaining_est: Number(d.remaining_est ?? 0),
    monthly_interest_est: d.monthly_interest_est == null ? null : Number(d.monthly_interest_est),
    monthly_payment: d.monthly_payment == null ? null : Number(d.monthly_payment),
  }))
}

export function monthsBack(month: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(month, -i))
  return out
}
