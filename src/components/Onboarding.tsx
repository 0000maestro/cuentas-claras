import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useApp } from '../state/AppContext'

interface Step { title: string; body: string; to: string; cta: string; done: boolean }

export default function Onboarding({ txCount, recurringCount, debtCount, rulesCount }: {
  txCount: number; recurringCount: number; debtCount: number; rulesCount: number
}) {
  const { org, entities, accounts } = useApp()
  const steps: Step[] = [
    {
      title: 'Revisa personas y empresas',
      body: 'Debe aparecer la persona dueña y cada empresa. Todo gasto se asigna a una de ellas.',
      to: '/configuracion', cta: 'Ver entidades', done: entities.length > 0,
    },
    {
      title: 'Confirma las cuentas',
      body: 'Una por cada cuenta corriente, tarjeta de crédito, línea o crédito, en cada banco. Si una falta, agrégala; si una no existe, elimínala.',
      to: '/configuracion', cta: 'Ver cuentas', done: accounts.length > 0,
    },
    {
      title: 'Sube las cartolas',
      body: 'Desde el sitio del banco, descarga la cartola en Excel o CSV de cada cuenta (ideal: desde octubre) y súbela aquí. Si solo tienes PDF, envíalo y lo convertimos.',
      to: '/importar', cta: 'Importar cartola', done: txCount > 0,
    },
    {
      title: 'Explica qué es cada gasto',
      body: 'En Movimientos, a cada salida ponle categoría y, si quieres, un nombre y una nota. Con “Explicar” el sistema recordará esa explicación para todos los cobros iguales, pasados y futuros.',
      to: '/movimientos', cta: 'Ir a movimientos', done: rulesCount > 0,
    },
    {
      title: 'Detecta los costos recurrentes',
      body: 'Con dos meses de cartolas, pulsa “Detectar en movimientos”. Decide uno por uno: se mantiene, se negocia o se cancela.',
      to: '/recurrentes', cta: 'Ver recurrentes', done: recurringCount > 0,
    },
    {
      title: 'Registra las deudas',
      body: 'Cada crédito, línea o tarjeta: acreedor, monto original, cuota, cuotas totales y tasa. Con eso se calcula cuánto falta y cuánto cuesta al mes.',
      to: '/deudas', cta: 'Agregar deuda', done: debtCount > 0,
    },
    {
      title: 'Fija la meta de recorte',
      body: 'Anota el costo fijo mensual de partida y el porcentaje a bajar. El panel mostrará el avance.',
      to: '/configuracion', cta: 'Fijar meta', done: !!org?.baseline_fixed_cost,
    },
  ]
  const doneCount = steps.filter(s => s.done).length
  const next = steps.find(s => !s.done)

  return (
    <section className="card p-6 mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold">Para empezar</h2>
        <span className="text-ink-2 text-[13px]">{doneCount} de {steps.length} pasos listos</span>
      </div>
      <ol className="grid md:grid-cols-2 gap-x-8 gap-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className={`flex gap-3 ${s.done ? 'opacity-60' : ''}`}>
            <span className={`mt-0.5 shrink-0 size-6 rounded-full grid place-items-center text-[12px] font-medium ${s.done ? 'bg-income text-white' : s === next ? 'bg-ink text-white' : 'bg-line text-ink-2'}`}>
              {s.done ? <Check size={13} /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className="font-medium">{s.title}</div>
              <p className="text-ink-2 text-[13px] mt-0.5">{s.body}</p>
              {!s.done && <Link to={s.to} className={`inline-block mt-1.5 text-[13px] ${s === next ? 'btn btn-primary btn-sm' : 'text-accent hover:underline'}`}>{s.cta}</Link>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
