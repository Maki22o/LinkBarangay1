-- Existing rows must survive the additive notification migration unchanged.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000999','legacy-notification@example.test');
insert into public.lb_notifications(id,user_id,title,message,is_read)
values('50000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000999','Legacy notification',
 'Saved before migration 0015',false);
-- Simulate a deployed legacy policy/grant that must never widen own-user reads.
create policy legacy_notifications_permissive on public.lb_notifications
  for select to public using (true);
grant select on public.lb_notifications to anon;
grant select(title) on public.lb_notifications to anon;
