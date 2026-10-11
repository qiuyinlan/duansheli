-- The organizing map is part of the existing AppData JSON envelope. It does
-- not use a separate table: IndexedDB exports and cloud sync all share the
-- same public.app_data.doc record and its existing per-user RLS policies.
-- This migration documents the JSON key for Supabase operators; no data copy
-- or policy change is required.
comment on column public.app_data.doc is
  'Full sync envelope (AppData + deletion tombstones); AppData.data.planMap stores organizing places.';
