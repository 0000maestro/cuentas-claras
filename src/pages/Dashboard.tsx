import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { fetchCategoryMonth, fetchDebts, fetchMonthlySummary, fetchRecurring, fetchTransactions, monthsBack, type CategoryMonth } from '../lib/queries'
import { compact, dateDay, money, monthLabel, pct, seriesColor } from '../lib/format'
import type { Debt, MonthlySummary, Recurring, Transaction } from '../lib/types'
import { Empty } from '../components/ui'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export default function Dashboard() {
  const { org, entityId, entities, month, categories, accounts, canEdit } = useApp()
  const [summary, setSummary] = useState<MonthlySummary[]>([])
  const [cats, setCats] = useState<CategoryMonth[]>([])
  const [recurring, setRecurring] = useState<Recurring[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [recent, setRecent] = useState<Transaction[]>([])
  const [loaded, setLoaded] = useState(false)

  const months = useMemo(() => monthsBack(month, 6), [month])

  useEffect(() => {
    if (!org) return
    let alive = true
    Promise.all([
      fetchMonthlySummary(org.id, org.baseline_month && org.baseline_month < months[0] ? org.baseline_month : months[0], months[months.length - 1]),
      fetchCategoryMonth(org.id, month, entityId),
      fetchRecurring(org.id, entityId),
      fetchDebts(org.id, entityId),
      fetchTransactions(org.id, { month, entityId, limit: 8 }),
    ]).then(([s, c, r, d, t]) => {
      if (!alive) return
      setSummary(s); setCats(c); setRecurring(r); setDebts(d); setRecent(t); setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { alive = false }
  }, [org, entityId, month, months])

  const filtered = useMemo(() => entityId ? summary.filter(s => s.entity_id === entityId) : summary, [summary, entityId])
  const fixedOf = (m: string | null | undefined) => m ? filtered.filter(s => s.month === m).reduce((a, r) => a + r.fixed_cost, 0) : 0
  const byMonth = useMemo(() => months.map(m => {
    const rows = filtered.filter(s => s.month === m)
    return {
      month: m, label: format(parseISO(m), 'MMM', { locale: es }),
      income: rows.reduce((a, r) => a + r.income, 0), expense: rows.reduce((a, r) => a + r.expense, 0),
      count: rows.reduce((a, r) => a + r.tx_count, 0),
    }
  }), [filtered, months])
  const monthsWithData = byMonth.filter(m => m.count > 0).length

  // Panorama del mes
  const income = cats.filter(c => c.total > 0)
  const out = cats.filter(c => c.total < 0)
  const variable = out.filter(c => c.is_variable)
  const operating = out.filter(c => !c.is_variable)
  const sum = (l: CategoryMonth[]) => l.reduce((a, c) => a + c.total, 0)
  const tIncome = sum(income), tVariable = -sum(variable), tOperating = -sum(operating)
  const tFixed = -sum(operating.filter(c => c.is_fixed))
  const result = tIncome - tVariable - tOperating
  const uncategorized = cats.find(c => c.category_id === null)
  const hasMonthData = cats.length > 0

  // Meta de recorte sobre el costo fijo
  const target = org ? Number(org.target_reduction_pct) : 25
  const baseline = org?.baseline_fixed_cost ?? (fixedOf(org?.baseline_month) || null)
  const isBaselineMonth = org?.baseline_month === month && !org?.baseline_fixed_cost
  const goalAmount = baseline ? baseline * (1 - target / 100) : null
  const reduced = baseline ? baseline - tFixed : 0
  const progress = baseline && !isBaselineMonth ? Math.max(0, Math.min(100, (reduced / (baseline * target / 100)) * 100)) : 0
  const toCut = recurring.filter(r => r.status === 'cancelar').reduce((a, r) => a + (r.monthly_equivalent ?? 0), 0)

  const debtsActive = debts.filter(d => d.status !== 'pagada')
  const debtRemaining = debtsActive.reduce((a, d) => a + (d.remaining_est ?? 0), 0)
  const debtMonthly = debtsActive.reduce((a, d) => a + (d.monthly_payment ?? 0), 0)
  const debtUnknown = debtsActive.filter(d => d.remaining_est == null).length

  if (!org) return null
  const title = entityId ? entities.find(e => e.id === entityId)?.name ?? 'Panel' : org.name
  const mes = monthLabel(month).toLowerCase()

  return (
    <div>
      <div className="mb-4 lg:mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{title}</h1>
        <p className="text-ink-2 mt-0.5">Así se movió la plata en {mes}</p>
      </div>

      {canEdit && !org.onboarding?.done && (
        <Link to="/bienvenida" className="card px-4 py-3 mb-4 flex items-center justify-between gap-3 hover:border-ink-3">
          <div>
            <div className="font-medium">Termina la configuración inicial</div>
            <div className="text-ink-2 text-[13px]">Confirma tus negocios, marca tus cuentas y sube lo que falta.</div>
          </div>
          <ArrowRight size={18} className="text-ink-2 shrink-0" />
        </Link>
      )}

      {loaded && !hasMonthData ? (
        <Empty
          title={`Sin movimientos en ${mes}`}
          body="Sube cartolas, estados de cuenta o capturas de pantalla de este mes, o cambia de mes arriba."
          action={canEdit && <Link to="/importar" className="btn btn-primary">Subir archivos</Link>}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-5 [&>*]:min-w-0">
          {/* Protagonista: costo fijo y meta */}
          <section className="card p-5 lg:p-6 lg:col-span-5">
            <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-end lg:justify-between gap-x-10 gap-y-5">
              <div>
                <div className="text-ink-2">Costo fijo de {mes}</div>
                <div className="num text-[34px] lg:text-[42px] leading-none font-semibold tracking-tight mt-2">{money(tFixed)}</div>
                <div className="text-ink-3 mt-2 text-[13px] max-w-[46ch]">Lo que cuesta mantener todo funcionando aunque no se venda nada: sueldos, arriendo, créditos, servicios y suscripciones.</div>
              </div>
              <div className="lg:min-w-[260px] lg:flex-1 lg:max-w-[520px]">
                {!baseline ? (
                  <p className="text-ink-2 text-[13px]">Fija el costo de partida en <Link to="/configuracion" className="text-accent hover:underline">Configuración → Meta de recorte</Link> para medir el avance.</p>
                ) : (
                  <>
                    <div className="flex justify-between text-[13px] mb-1.5">
                      <span className="text-ink-2">Meta: bajar {pct(target)}</span>
                      <span className="num text-ink-2">llegar a {money(goalAmount)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-income rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="flex justify-between text-[13px] mt-1.5 gap-3">
                      <span className="num">
                        {isBaselineMonth ? <span className="text-ink-2">Este es el mes de partida: hay que recortar {money(baseline * target / 100)}</span>
                          : reduced > 0 ? <span className="text-income">Bajó {money(reduced)} desde {money(baseline)}</span>
                          : <span className="text-bad">Subió {money(-reduced)} desde {money(baseline)}</span>}
                      </span>
                      {toCut > 0 && <span className="text-ink-2 num shrink-0">Decidido cortar: {money(toCut)}</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Estado del mes en cuatro líneas */}
          <section className="card p-5 lg:col-span-2">
            <h2 className="font-semibold mb-3">El mes en cuatro líneas</h2>
            <FlowRow label="Entró" value={tIncome} max={Math.max(tIncome, tVariable, tOperating)} color="#008300" />
            <FlowRow label="Costo de lo que vendes" hint="Lo que compras para vender y lo que cuesta dejarlo listo" value={-tVariable} max={Math.max(tIncome, tVariable, tOperating)} color="#16191c" />
            <FlowRow label="Costo de operar" hint={`Fijo ${compact(tFixed)} + otros ${compact(tOperating - tFixed)}`} value={-tOperating} max={Math.max(tIncome, tVariable, tOperating)} color="#4e555c" />
            <div className="border-t border-line mt-3 pt-3 flex items-baseline justify-between">
              <span className="font-medium">Resultado de caja</span>
              <span className={`num text-[20px] font-semibold ${result >= 0 ? 'text-income' : 'text-bad'}`}>{money(result, { sign: true })}</span>
            </div>
            <p className="text-ink-3 text-[12px] mt-2">Es plata que entró menos plata que salió, sin traspasos entre cuentas propias. No es utilidad: lo comprado este mes puede venderse el siguiente.</p>
          </section>

          <section className="card p-5 lg:col-span-3">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">En qué se va el costo de operar</h2>
              <span className="num text-ink-2 text-[13px]">{money(tOperating)}</span>
            </div>
            <CategoryBars items={operating} total={tOperating} showFixed />
            {uncategorized && uncategorized.total < 0 && (
              <Link to="/movimientos" className="text-accent text-[13px] hover:underline inline-block mt-3">
                {uncategorized.n} movimientos sin explicar por {money(-uncategorized.total)}: decir qué son
              </Link>
            )}
          </section>

          <section className="card p-5 lg:col-span-3">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">Costo de lo que vendes</h2>
              <span className="num text-ink-2 text-[13px]">{money(tVariable)}</span>
            </div>
            {variable.length ? <CategoryBars items={variable} total={tVariable} /> : <p className="text-ink-2">Nada clasificado aquí este mes.</p>}
          </section>

          <section className="card p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">De dónde entra</h2>
              <span className="num text-income text-[13px]">{money(tIncome)}</span>
            </div>
            {income.length ? <CategoryBars items={income} total={tIncome} color="#008300" /> : <p className="text-ink-2">Sin entradas este mes.</p>}
          </section>

          {monthsWithData >= 2 && (
            <section className="card p-5 lg:col-span-3">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-semibold">Entradas y salidas por mes</h2>
                <div className="flex items-center gap-4 text-[12.5px] text-ink-2">
                  <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: '#008300' }} />Entradas</span>
                  <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: '#16191c' }} />Salidas</span>
                </div>
              </div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byMonth} barGap={2} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="#e3e6e5" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#8a9097', fontSize: 12 }} />
                    <YAxis tickFormatter={v => compact(v)} tickLine={false} axisLine={false} width={64} tick={{ fill: '#8a9097', fontSize: 12 }} />
                    <Tooltip cursor={{ fill: '#f6f7f6' }} formatter={(v, n) => [money(Number(v)), n === 'income' ? 'Entradas' : 'Salidas']}
                      labelFormatter={(_, p) => p?.[0] ? monthLabel(p[0].payload.month) : ''} contentStyle={{ borderRadius: 8, border: '1px solid #e3e6e5', fontSize: 13 }} />
                    <Bar dataKey="income" fill="#008300" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" fill="#16191c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className={`card p-5 ${monthsWithData >= 2 ? 'lg:col-span-2' : 'lg:col-span-5'}`}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">Deudas</h2>
              <Link to="/deudas" className="text-accent text-[13px] hover:underline">Ver todas</Link>
            </div>
            {debtsActive.length === 0 ? (
              <p className="text-ink-2">Sin deudas registradas. Agrégalas en Deudas o sube el informe de la CMF.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4">
                  <div><div className="num text-[22px] font-semibold tracking-tight">{money(debtMonthly)}</div><div className="text-ink-3 text-[12.5px]">en cuotas cada mes</div></div>
                  <div><div className="num text-[22px] font-semibold tracking-tight">{debtRemaining > 0 ? money(debtRemaining) : 'Sin dato'}</div><div className="text-ink-3 text-[12.5px]">saldo por pagar{debtUnknown ? ` (falta en ${debtUnknown} de ${debtsActive.length})` : ''}</div></div>
                </div>
                <ul className="flex flex-col divide-y divide-line/70">
                  {debtsActive.slice(0, 6).map(d => (
                    <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="size-2 rounded-full shrink-0" style={{ background: seriesColor(entities.find(e => e.id === d.entity_id)?.color_slot ?? 1) }} />
                        <span className="truncate">{d.creditor}</span>
                      </span>
                      <span className="num text-ink-2 shrink-0 text-[13px]">{d.monthly_payment ? `${compact(d.monthly_payment)}/mes` : d.remaining_est != null ? compact(d.remaining_est) : 'falta dato'}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card lg:col-span-5">
            <div className="flex items-baseline justify-between px-5 pt-5 pb-2">
              <h2 className="font-semibold">Últimos movimientos</h2>
              <Link to="/movimientos" className="text-accent text-[13px] hover:underline">Ver todos</Link>
            </div>
            <ul className="divide-y divide-line/70">
              {recent.map(t => (
                <li key={t.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate">{t.counterparty ?? t.description}</div>
                    <div className="text-ink-3 text-[12.5px] truncate">
                      {dateDay(t.posted_at)} · {t.is_transfer ? 'Traspaso propio' : categories.find(c => c.id === t.category_id)?.name ?? 'Sin categoría'} · {accounts.find(a => a.id === t.account_id)?.bank ?? ''}
                    </div>
                  </div>
                  <div className={`num shrink-0 font-medium ${t.amount > 0 && !t.is_transfer ? 'text-income' : ''}`}>{money(t.amount, { sign: true })}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

function FlowRow({ label, hint, value, max, color }: { label: string; hint?: string; value: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <span className={`num font-medium ${value > 0 ? 'text-income' : ''}`}>{money(value, { sign: true })}</span>
      </div>
      <div className="h-2 rounded-full bg-line mt-1.5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} /></div>
      {hint && <div className="text-ink-3 text-[12px] mt-1">{hint}</div>}
    </div>
  )
}

function CategoryBars({ items, total, color = '#16191c', showFixed }: { items: CategoryMonth[]; total: number; color?: string; showFixed?: boolean }) {
  const sorted = [...items].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  const top = sorted.slice(0, 9)
  const rest = sorted.slice(9)
  const max = Math.abs(top[0]?.total ?? 0)
  const restTotal = rest.reduce((a, c) => a + Math.abs(c.total), 0)
  return (
    <ul className="flex flex-col gap-2.5">
      {top.map(c => (
        <li key={c.category_id ?? 'none'}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="truncate">
              {c.category_name ?? <span className="text-[#8a5c00]">Sin explicar todavía</span>}
              {showFixed && c.is_fixed && <span className="text-ink-3 text-[11.5px] ml-1.5">fijo</span>}
            </span>
            <span className="num shrink-0">{money(Math.abs(c.total))} <span className="text-ink-3 text-[12px]">{total > 0 ? pct((Math.abs(c.total) / total) * 100) : ''}</span></span>
          </div>
          <div className="h-1.5 rounded-full bg-line mt-1 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.max(1.5, (Math.abs(c.total) / max) * 100) : 0}%`, background: showFixed && !c.is_fixed ? '#8a9097' : color }} />
          </div>
        </li>
      ))}
      {rest.length > 0 && <li className="text-ink-3 text-[12.5px]">y {rest.length} categorías más por {money(restTotal)}</li>}
    </ul>
  )
}
