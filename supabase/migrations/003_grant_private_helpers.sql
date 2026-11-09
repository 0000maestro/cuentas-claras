-- Las políticas RLS se evalúan con los privilegios del usuario que consulta,
-- así que los helpers de seguridad deben ser ejecutables por authenticated.
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.can_edit_org(uuid) to authenticated;
