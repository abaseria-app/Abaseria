-- 009: holding table for spreadsheet uploads. Rows are checked, de-duplicated and moved into products,
-- then cleared. The app's keys can't touch it (RLS on, no policies, no grants); only the server key can.
-- Applied to abaseria-dev on Nov 9 as 009_product_import_holding_table; recovered into the repo Nov 11.
-- Not yet run in prod. Safe to run twice.

create table if not exists public.product_import (
  barcode     text,
  name        text,
  size        text,
  category    text,
  uploaded_at timestamptz not null default now()
);
comment on table public.product_import is 'Holding table for CSV uploads from the dashboard. No rules here; rows are checked, de-duplicated and moved into products, then cleared.';
alter table public.product_import enable row level security;
revoke all on public.product_import from anon, authenticated;
