import { supabase } from './supabase'
import type { DocumentRow } from './types'

const safe = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)

/** Guarda el archivo original en el almacenamiento privado de la organización y lo registra en la bandeja. */
export async function saveDocument(args: {
  orgId: string; file: File; kind: DocumentRow['kind']; status: DocumentRow['status']
  entityId?: string | null; accountId?: string | null; text?: string; rowsFound?: number; rowsImported?: number; note?: string | null
}): Promise<{ id: string | null; stored: boolean; error?: string }> {
  const path = `${args.orgId}/${crypto.randomUUID()}-${safe(args.file.name)}`
  const up = await supabase.storage.from('documentos').upload(path, args.file, { contentType: args.file.type || 'application/octet-stream' })
  const { data: u } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('documents').insert({
    org_id: args.orgId, entity_id: args.entityId ?? null, account_id: args.accountId ?? null,
    kind: args.kind, status: args.status, filename: args.file.name,
    storage_path: up.error ? null : path, mime: args.file.type || null, size_bytes: args.file.size,
    extracted_text: args.text ? args.text.slice(0, 200000) : null,
    rows_found: args.rowsFound ?? 0, rows_imported: args.rowsImported ?? 0, note: args.note ?? null,
    created_by: u.user?.id ?? null,
  }).select('id').single()
  return { id: (data as { id: string } | null)?.id ?? null, stored: !up.error, error: error?.message ?? up.error?.message }
}

export async function listDocuments(orgId: string, limit = 12): Promise<DocumentRow[]> {
  const { data } = await supabase.from('documents')
    .select('id, org_id, entity_id, account_id, kind, filename, storage_path, rows_found, rows_imported, status, note, created_at')
    .eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit)
  return (data as DocumentRow[]) ?? []
}
