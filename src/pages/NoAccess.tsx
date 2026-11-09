import { useApp } from '../state/AppContext'
import Wordmark from '../components/Wordmark'

export default function NoAccess() {
  const { session, signOut, refreshOrgs } = useApp()
  return (
    <div className="min-h-full grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <Wordmark className="mb-10" />
        <div className="card p-6">
          <h1 className="text-lg font-semibold mb-2">Todavía no tienes acceso</h1>
          <p className="text-ink-2">
            Entraste como <span className="font-medium text-ink">{session?.user.email}</span>, pero ese correo no
            está invitado a ninguna organización. Pide a quien administra el sistema que te invite con este correo.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn btn-primary" onClick={() => refreshOrgs()}>Volver a revisar</button>
            <button className="btn btn-ghost" onClick={() => signOut()}>Salir</button>
          </div>
        </div>
      </div>
    </div>
  )
}
