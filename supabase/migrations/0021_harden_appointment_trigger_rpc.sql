-- Trigger-only helper: callers must not invoke it as an API RPC.
revoke all on function public.app_sync_assignment_appointment() from public, anon, authenticated;
