-- Remove duplicate indexes; migration 0008 already created indexes for these FKs.
drop index if exists public.lb_profiles_barangay_id_idx;
drop index if exists public.lb_profiles_department_id_idx;
