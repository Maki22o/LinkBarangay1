-- Test-only compatibility fixture for the supplied historical archive.
-- 0004 already uses canonical worker functions, whereas 0007 insists it must
-- replace legacy role strings. Restore just those historical strings before
-- replaying the unchanged 0007, which then converts them back. No application
-- migration is edited or skipped; 0015 is tested exactly as shipped.
do $$
declare fn record; definition text;
begin
  for fn in select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'app_transition_request','app_assign_field','app_add_comment',
      'app_escalate_request','app_decline_assignment')
  loop
    definition := pg_get_functiondef(fn.oid);
    if fn.proname = 'app_decline_assignment' then
      definition := replace(definition,
        'where p.role = ''worker'' and p.worker_function = ''dispatcher'' and p.status = ''active''',
        'where p.role = ''dispatcher'' and p.status = ''active''');
    else
      definition := replace(definition, 'select coalesce(worker_function, role), status,', 'select role, status,');
      if fn.proname = 'app_assign_field' then
        definition := replace(definition,
          'v_field.role <> ''worker'' or v_field.worker_function <> ''field''',
          'v_field.role <> ''field''');
      end if;
    end if;
    execute definition;
  end loop;
end $$;
