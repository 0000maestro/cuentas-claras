-- Ya aplicada en Conciliation como "category_month_view" (20261110053333).
-- Total por categoría y mes (sin traspasos). is_variable = costo de lo que se vende, no costo de operar.
create or replace view public.v_category_month with (security_invoker = true) as
select t.org_id, t.entity_id, date_trunc('month', t.posted_at)::date as month,
       t.category_id, c.name as category_name, c.kind as category_kind,
       coalesce(c.is_fixed, false) as is_fixed,
       coalesce(c.exclude_from_recurring, false) as is_variable,
       sum(t.amount) as total, count(*) as n
from public.transactions t
left join public.categories c on c.id = t.category_id
where not t.is_transfer
group by 1, 2, 3, 4, 5, 6, 7, 8;
