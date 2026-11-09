-- =====================================================================
-- Ahorro compartido · tipo "proceso" (aplicado 2026-11-09)
--
-- Para ahorros que no son un cargo que desaparece, sino una forma más barata
-- de hacer algo (ej.: comprar USDT por P2P en vez de Santander → tarjeta →
-- Binance). Se mide el costo real por unidad (CLP por USDT) antes y después:
--   ahorro = Σ (unidades × costo_unitario_antes − CLP pagados) en el mes de medición
--   comisión = 50% de ese ahorro, una sola vez.
-- Cada operación se cruza con la transferencia real en la cartola (monto ±1,
-- fecha ±3 días). Solo se verifica cuando todas las operaciones están cruzadas
-- y las cartolas cubren el mes completo.
-- =====================================================================

alter table public.savings_events
  add column kind text not null default 'cargo' check (kind in ('cargo','proceso')),
  add column unit_label text,
  add column rate_before numeric,
  add column rate_after numeric,
  add column volume_units numeric;

alter table public.savings_events alter column amount_before drop not null;
alter table public.savings_events alter column match_pattern drop not null;
alter table public.savings_events drop constraint savings_events_amount_before_check;
alter table public.savings_events add constraint savings_events_amount_before_check
  check (kind = 'proceso' or amount_before > 0);
alter table public.savings_events drop constraint savings_events_action_check;
alter table public.savings_events add constraint savings_events_action_check
  check (action in ('cancelado','renegociado','rebajado','cambio_proceso','otro'));

-- Operaciones que respaldan un ahorro de proceso
create table public.process_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  saving_id uuid not null references public.savings_events(id) on delete cascade,
  phase text not null check (phase in ('antes','despues')),
  op_date date not null,
  clp_amount numeric not null check (clp_amount > 0),
  units numeric not null check (units > 0),
  reference text,                -- nº de orden P2P / comprobante
  account_id uuid references public.accounts(id),
  transaction_id bigint references public.transactions(id),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index process_operations_saving_idx on public.process_operations (saving_id);
create unique index process_operations_tx_uniq on public.process_operations (transaction_id) where transaction_id is not null;

alter table public.process_operations enable row level security;
create policy process_operations_select on public.process_operations for select
  using ((select private.is_org_member(org_id)));
create policy process_operations_insert on public.process_operations for insert
  with check ((select private.can_edit_org(org_id)));
create policy process_operations_update on public.process_operations for update
  using ((select private.can_edit_org(org_id)))
  with check ((select private.can_edit_org(org_id)));
create policy process_operations_delete on public.process_operations for delete
  using ((select private.can_edit_org(org_id)));

-- Si el ahorro ya está verificado, sus operaciones quedan congeladas.
create or replace function private.process_operations_guard()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_status text; v_org uuid;
begin
  select status, org_id into v_status, v_org from public.savings_events
   where id = coalesce(new.saving_id, old.saving_id);
  if v_status in ('verificado','reaparecio','no_logrado') then
    raise exception 'El ahorro ya fue resuelto: sus operaciones no se pueden modificar.';
  end if;
  if tg_op <> 'DELETE' and new.org_id <> v_org then
    raise exception 'La operación debe pertenecer a la misma organización del ahorro.';
  end if;
  return coalesce(new, old);
end $$;

create trigger process_operations_guard
  before insert or update or delete on public.process_operations
  for each row execute function private.process_operations_guard();

-- Registrar un ahorro de proceso (ventana = mes de medición)
create or replace function public.register_process_saving(
  p_org uuid, p_title text, p_unit_label text,
  p_measure_start date, p_measure_end date,
  p_entity uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path to ''
as $$
declare v_agreement uuid; v_pct numeric; v_id uuid;
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;
  if p_measure_end < p_measure_start then raise exception 'rango de medición inválido'; end if;
  select id, commission_pct into v_agreement, v_pct from public.agreements
   where org_id = p_org and kind = 'ahorro_compartido' order by created_at desc limit 1;
  insert into public.savings_events (
    org_id, agreement_id, entity_id, kind, title, action, action_note, unit_label,
    window_start, window_end, grace_days, commission_pct, created_by
  ) values (
    p_org, v_agreement, p_entity, 'proceso', p_title, 'cambio_proceso', p_note, p_unit_label,
    p_measure_start, p_measure_end, 3, coalesce(v_pct, 50), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end $$;

-- Verificación: cargos (como antes) + procesos
CREATE OR REPLACE FUNCTION public.verify_savings(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e record; o record; v_count int := 0;
  v_deadline date; v_cover date;
  v_tx bigint; v_found numeric; v_found_date date;
  v_saving numeric; v_import uuid;
  v_pending int; v_b_clp numeric; v_b_units numeric; v_a_clp numeric; v_a_units numeric;
  v_rate_b numeric; v_rate_a numeric;
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;

  -- a) cargos pendientes
  for e in select * from public.savings_events
            where org_id = p_org and status = 'pendiente' and kind = 'cargo' loop
    v_deadline := e.window_end + e.grace_days;

    if e.account_id is not null then
      select max(t.posted_at) into v_cover from public.transactions t
       where t.org_id = p_org and t.account_id = e.account_id;
    else
      select min(mx) into v_cover from (
        select max(t.posted_at) as mx from public.transactions t
         where t.org_id = p_org group by t.account_id) s;
    end if;
    if v_cover is null or v_cover < v_deadline then continue; end if;

    v_tx := null; v_found := null; v_found_date := null;
    select t.id, abs(t.amount), t.posted_at
      into v_tx, v_found, v_found_date
      from public.transactions t
     where t.org_id = p_org and t.amount < 0 and not t.is_transfer
       and t.posted_at between e.window_start and v_deadline
       and t.description_norm ilike '%' || lower(e.match_pattern) || '%'
     order by abs(t.amount) desc limit 1;

    if v_tx is null then
      v_saving := e.amount_before; v_found := 0;
    elsif v_found <= e.amount_before * 0.95 then
      v_saving := e.amount_before - v_found;
    else
      update public.savings_events
         set status = 'no_logrado',
             amount_after_actual = v_found,
             verification_detail = format(
               'El cargo apareció por $%s el %s dentro de la ventana esperada (%s a %s). No hubo ahorro.',
               replace(to_char(v_found, 'FM999,999,999,999'), ',', '.'), v_found_date, e.window_start, v_deadline)
       where id = e.id;
      continue;
    end if;

    select t.import_id into v_import
      from public.transactions t
     where t.org_id = p_org
       and (e.account_id is null or t.account_id = e.account_id)
       and t.posted_at >= e.window_start and t.import_id is not null
     order by t.posted_at desc limit 1;

    update public.savings_events
       set status = 'verificado',
           amount_after_actual = v_found,
           monthly_saving = v_saving,
           commission_amount = round(v_saving * savings_events.commission_pct / 100, 0),
           commission_status = 'devengada',
           verified_at = now(),
           verified_import_id = v_import,
           verification_detail = case when v_tx is null
             then format('No apareció ningún cargo que coincida con "%s" entre %s y %s, con cartolas cargadas hasta el %s.',
                         e.match_pattern, e.window_start, v_deadline, v_cover)
             else format('El cargo apareció rebajado: $%s el %s (antes $%s).',
                         replace(to_char(v_found, 'FM999,999,999,999'), ',', '.'), v_found_date,
                         replace(to_char(e.amount_before, 'FM999,999,999,999'), ',', '.')) end
     where id = e.id;
    v_count := v_count + 1;
  end loop;

  -- b) procesos pendientes
  for e in select * from public.savings_events
            where org_id = p_org and status = 'pendiente' and kind = 'proceso' loop
    -- b1) cruzar operaciones con la cartola (salida por el mismo monto ±1, fecha ±3 días)
    for o in select * from public.process_operations
              where saving_id = e.id and transaction_id is null loop
      v_tx := null;
      select t.id into v_tx
        from public.transactions t
       where t.org_id = p_org and t.amount < 0
         and abs(abs(t.amount) - o.clp_amount) <= 1
         and t.posted_at between o.op_date - 3 and o.op_date + 3
         and (o.account_id is null or t.account_id = o.account_id)
         and not exists (select 1 from public.process_operations x where x.transaction_id = t.id)
       order by abs(t.posted_at - o.op_date), t.id
       limit 1;
      if v_tx is not null then
        update public.process_operations set transaction_id = v_tx where id = o.id;
      end if;
    end loop;

    -- b2) ¿listo para resolver?
    v_deadline := e.window_end + e.grace_days;
    select min(mx) into v_cover from (
      select max(t.posted_at) as mx from public.transactions t
       where t.org_id = p_org
         and t.account_id in (select coalesce(po.account_id, t2.account_id)
                                from public.process_operations po
                                left join public.transactions t2 on t2.id = po.transaction_id
                               where po.saving_id = e.id and po.phase = 'despues')
       group by t.account_id) s;
    if v_cover is null or v_cover < v_deadline then continue; end if;

    select count(*) filter (where transaction_id is null),
           sum(clp_amount) filter (where phase = 'antes'),
           sum(units)      filter (where phase = 'antes'),
           sum(clp_amount) filter (where phase = 'despues' and op_date between e.window_start and e.window_end),
           sum(units)      filter (where phase = 'despues' and op_date between e.window_start and e.window_end)
      into v_pending, v_b_clp, v_b_units, v_a_clp, v_a_units
      from public.process_operations where saving_id = e.id;

    if v_pending > 0 or coalesce(v_b_units,0) = 0 or coalesce(v_a_units,0) = 0 then continue; end if;

    v_rate_b := v_b_clp / v_b_units;
    v_rate_a := v_a_clp / v_a_units;
    v_saving := round(v_a_units * v_rate_b - v_a_clp, 0);

    if v_saving <= 0 then
      update public.savings_events
         set status = 'no_logrado', rate_before = v_rate_b, rate_after = v_rate_a, volume_units = v_a_units,
             verification_detail = format('Costo por %s: antes $%s, después $%s. El proceso nuevo no resultó más barato.',
               e.unit_label, round(v_rate_b, 2), round(v_rate_a, 2))
       where id = e.id;
      continue;
    end if;

    update public.savings_events
       set status = 'verificado',
           rate_before = v_rate_b, rate_after = v_rate_a, volume_units = v_a_units,
           monthly_saving = v_saving,
           commission_amount = round(v_saving * savings_events.commission_pct / 100, 0),
           commission_status = 'devengada',
           verified_at = now(),
           verification_detail = format(
             'Costo por %s: antes $%s (línea base), después $%s. Volumen del %s al %s: %s %s por $%s. Ahorro: $%s. Todas las operaciones cruzadas con la cartola.',
             e.unit_label, round(v_rate_b, 2), round(v_rate_a, 2), e.window_start, e.window_end,
             round(v_a_units, 2), e.unit_label,
             replace(to_char(v_a_clp, 'FM999,999,999,999'), ',', '.'),
             replace(to_char(v_saving, 'FM999,999,999,999'), ',', '.'))
     where id = e.id;
    v_count := v_count + 1;
  end loop;

  -- c) reapariciones de cargos (informativo)
  for e in select * from public.savings_events
            where org_id = p_org and status = 'verificado' and kind = 'cargo' loop
    v_tx := null;
    select t.id, t.posted_at, abs(t.amount)
      into v_tx, v_found_date, v_found
      from public.transactions t
     where t.org_id = p_org and t.amount < 0 and not t.is_transfer
       and t.posted_at > e.window_end + e.grace_days
       and t.description_norm ilike '%' || lower(e.match_pattern) || '%'
       and abs(t.amount) > coalesce(e.amount_after_actual, 0) + greatest(e.monthly_saving * 0.2, 1000)
     order by t.posted_at asc limit 1;
    if v_tx is not null then
      update public.savings_events
         set status = 'reaparecio', reappeared_at = v_found_date, reappeared_tx = v_tx
       where id = e.id;
    end if;
  end loop;

  return v_count;
end $function$;

-- el guard de inmutabilidad también cubre los campos de proceso
CREATE OR REPLACE FUNCTION private.savings_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.status in ('verificado','reaparecio') then
      raise exception 'Ahorro verificado: no se puede eliminar.';
    end if;
    return old;
  end if;
  if old.status in ('verificado','reaparecio') then
    if new.amount_before        is distinct from old.amount_before
    or new.amount_after_expected is distinct from old.amount_after_expected
    or new.amount_after_actual  is distinct from old.amount_after_actual
    or new.monthly_saving       is distinct from old.monthly_saving
    or new.commission_pct       is distinct from old.commission_pct
    or new.commission_amount    is distinct from old.commission_amount
    or new.verified_at          is distinct from old.verified_at
    or new.verified_import_id   is distinct from old.verified_import_id
    or new.verification_detail  is distinct from old.verification_detail
    or new.match_pattern        is distinct from old.match_pattern
    or new.window_start         is distinct from old.window_start
    or new.window_end           is distinct from old.window_end
    or new.title                is distinct from old.title
    or new.action               is distinct from old.action
    or new.org_id               is distinct from old.org_id
    or new.kind                 is distinct from old.kind
    or new.rate_before          is distinct from old.rate_before
    or new.rate_after           is distinct from old.rate_after
    or new.volume_units         is distinct from old.volume_units
    then
      raise exception 'Ahorro verificado: los datos económicos son inmutables.';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'verificado' and new.status = 'reaparecio') then
      raise exception 'Transición de estado no permitida.';
    end if;
  end if;
  return new;
end $function$;

-- recrear la vista para incluir las columnas nuevas
drop view if exists public.v_savings;
create view public.v_savings with (security_invoker = on) as
select s.*,
       a.terms_md, a.accepted_at as agreement_accepted_at,
       e.name as entity_name,
       (select count(*) from public.process_operations po where po.saving_id = s.id) as ops_total,
       (select count(*) from public.process_operations po where po.saving_id = s.id and po.transaction_id is not null) as ops_linked
  from public.savings_events s
  left join public.agreements a on a.id = s.agreement_id
  left join public.entities e on e.id = s.entity_id;
