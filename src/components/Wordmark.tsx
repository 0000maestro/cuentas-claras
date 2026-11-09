export default function Wordmark({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <rect x="1" y="1" width="24" height="24" rx="6" fill="#16191c" />
        <rect x="6" y="15" width="3" height="5" rx="1" fill="#f6f7f6" />
        <rect x="11.5" y="10" width="3" height="10" rx="1" fill="#f6f7f6" />
        <rect x="17" y="6" width="3" height="14" rx="1" fill="#2a78d6" />
      </svg>
      {!compact && <span className="font-semibold tracking-tight text-[15px]">Cuentas Claras</span>}
    </div>
  )
}
