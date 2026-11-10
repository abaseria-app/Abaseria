// Runs schema.sql against in-memory Postgres (PGlite) with stand-ins for Supabase's auth schema and roles,
// then checks the read/add/no-edit rules. Run before pasting a changed schema into either Supabase project.
// Usage: npm run test:schema
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const db = new PGlite();
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const B1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${U1}'), ('${U2}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Like Supabase: new functions in public are granted to anon and authenticated directly.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  -- Stand-in for Supabase Storage: just what the checks use. Supabase turns on RLS for objects itself.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`);
await db.exec(schema);
// Migrations must apply cleanly on top of the current schema too.
for (const f of readdirSync(new URL('./migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`./migrations/${f}`, import.meta.url), 'utf8'));
}

let pass = 0, fail = 0;
async function as(role, uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
}
async function ok(name, role, uid, sql, check = () => true) {
  try { const r = await as(role, uid, sql); if (check(r)) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, JSON.stringify(r.rows)); } }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}
async function refused(name, role, uid, sql) {
  try { const r = await as(role, uid, sql); if ((r.affectedRows ?? 0) === 0 && /^(update|delete)/i.test(sql.trim())) { pass++; console.log('PASS', name, '(0 rows)'); } else { fail++; console.log('FAIL', name, 'was allowed'); } }
  catch { pass++; console.log('PASS', name); }
}

const today = new Date().toISOString().slice(0, 10);
await ok('signed-in phone adds a branch', 'authenticated', U1, `insert into public.branches (id, chain, name, lat, lng) values ('${B1}', 'Puregold', 'Imus', 14.42, 120.94)`);
await refused('duplicate branch (same chain + name, any case)', 'authenticated', U2, `insert into public.branches (id, chain, name) values (gen_random_uuid(), 'puregold', 'IMUS')`);
await refused('swapped lat/lng', 'authenticated', U1, `insert into public.branches (id, chain, name, lat, lng) values (gen_random_uuid(), 'SM', 'Bacoor', 120.9, 14.4)`);
await refused('logged-out phone adds a branch', 'anon', null, `insert into public.branches (id, chain, name) values (gen_random_uuid(), 'SM', 'Molino')`);
await ok('signed-in phone adds a product', 'authenticated', U1, `insert into public.products (barcode, name, size) values ('4800016644818', 'Test product', '250 ml')`);
await refused('bad check digit', 'authenticated', U1, `insert into public.products (barcode, name) values ('4800016644819', 'Bad')`);
await refused('in-store scale code', 'authenticated', U1, `insert into public.products (barcode, name) values ('2000000000008', 'Scale')`);
const sighting = (cid, day = today, extra = '') => `insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method${extra ? ', bundle_qty' : ''}) values ('${cid}', '4800016644818', '${B1}', '${day}', ${extra ? "'bundle'" : "'each'"}, 11500, 'tag'${extra ? ', 3' : ''})`;
await ok('signed-in phone adds a sighting', 'authenticated', U1, sighting('c0000000-0000-4000-8000-000000000001'));
await refused('same sighting uploaded twice', 'authenticated', U1, sighting('c0000000-0000-4000-8000-000000000001'));
await refused('sighting older than 14 days', 'authenticated', U1, sighting('c0000000-0000-4000-8000-000000000002', '2020-01-01'));
await refused('bundle missing its price', 'authenticated', U1, sighting('c0000000-0000-4000-8000-000000000003', today, 'x'));
await refused('faked contributor id', 'authenticated', U1, `insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method, contributor) values (gen_random_uuid(), '4800016644818', '${B1}', '${today}', 'each', 100, 'tag', '${U2}')`);
await ok('a shared price can be confirmed', 'authenticated', U2, `insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method) values ('c0000000-0000-4000-8000-000000000009', '4800016644818', '${B1}', '${today}', 'each', 11500, 'shared')`);
await refused('unknown capture method', 'authenticated', U2, `insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method) values (gen_random_uuid(), '4800016644818', '${B1}', '${today}', 'each', 11500, 'guess')`);
await ok('re-upload of a known product is ignored, not an error', 'authenticated', U2, `insert into public.products (barcode, name) values ('4800016644818', 'Other name') on conflict (barcode) do nothing`);
await ok('re-upload of a sighting is ignored, not an error', 'authenticated', U1, `insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method) values ('c0000000-0000-4000-8000-000000000001', '4800016644818', '${B1}', '${today}', 'each', 11500, 'tag') on conflict (client_id) do nothing`);
await ok('logged-out phone reads latest price', 'anon', null, `select unit_price_centavos from public.latest_prices where barcode = '4800016644818'`, (r) => r.rows[0]?.unit_price_centavos === 11500);
await refused('contributor column hidden', 'anon', null, `select contributor from public.price_sightings`);
// Security review (010): who added a product or store is hidden too; the view is read-only.
await refused('product created_by hidden from logged-out phones', 'anon', null, `select created_by from public.products`);
await refused('product created_by hidden from signed-in phones', 'authenticated', U2, `select created_by from public.products`);
await refused('branch created_by hidden from logged-out phones', 'anon', null, `select created_by from public.branches`);
await refused('branch created_by hidden from signed-in phones', 'authenticated', U2, `select created_by from public.branches`);
await refused('select * on products (hidden column)', 'anon', null, `select * from public.products`);
await ok('logged-out phone reads every other product column', 'anon', null, `select barcode, name, size, category, status, image_path, created_at from public.products`, (r) => r.rows.length >= 1);
await ok('logged-out phone reads every other branch column', 'anon', null, `select id, chain, name, lat, lng, created_at from public.branches`, (r) => r.rows.length >= 1);
await ok('connection-check counts still work', 'anon', null, `select (select count(barcode) from public.products) + (select count(id) from public.branches) + (select count(barcode) from public.latest_prices) as n`, (r) => r.rows[0]?.n >= 3);
await refused('write through latest_prices', 'authenticated', U1, `insert into public.latest_prices (barcode, branch_id, seen_on, price_type, unit_price_centavos) values ('4800016644818', '${B1}', '${today}', 'each', 1)`);
await ok('known_barcodes runs with the caller\'s rights', 'postgres', null, `select prosecdef from pg_proc where proname = 'known_barcodes'`, (r) => r.rows[0]?.prosecdef === false);
await ok('gtin_ok has a fixed search path', 'postgres', null, `select proconfig from pg_proc where proname = 'gtin_ok'`, (r) => String(r.rows[0]?.proconfig).includes('search_path'));
await refused('edit a sighting', 'authenticated', U1, `update public.price_sightings set unit_price_centavos = 1`);
await refused('delete a sighting', 'authenticated', U1, `delete from public.price_sightings`);
await refused('edit a product', 'authenticated', U1, `update public.products set name = 'x'`);

// Pending / Published (004, 005, 010): Pending products wait for a Product Manager, but everyone sees them (Nov 9).
const P = '4800888123459';
await ok('new product starts Pending', 'authenticated', U1, `insert into public.products (barcode, name, category) values ('${P}', 'Magnolia Chicken Nuggets', 'meat, poultry & seafood')`);
await ok('...and is Pending in the database', 'postgres', null, `select status from public.products where barcode = '${P}'`, (r) => r.rows[0]?.status === 'pending');
await refused('phone publishes its own product', 'authenticated', U1, `insert into public.products (barcode, name, status) values ('4800777123454', 'X', 'published')`);
await refused('phone publishes a product later', 'authenticated', U1, `update public.products set status = 'published'`);
await ok('the shopper who added it still sees it', 'authenticated', U1, `select name from public.products where barcode = '${P}'`, (r) => r.rows.length === 1);
await ok('other shoppers see a Pending product', 'authenticated', U2, `select name from public.products where barcode = '${P}'`, (r) => r.rows.length === 1);
await ok('logged-out phones see a Pending product', 'anon', null, `select name from public.products where barcode = '${P}'`, (r) => r.rows.length === 1);
await ok('price for a Pending product can be added', 'authenticated', U1, `insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method) values ('c0000000-0000-4000-8000-000000000020', '${P}', '${B1}', '${today}', 'each', 18900, 'tag')`);
await ok('other shoppers see a Pending product\'s price', 'authenticated', U2, `select unit_price_centavos from public.latest_prices where barcode = '${P}'`, (r) => r.rows[0]?.unit_price_centavos === 18900);
await ok('known_barcodes finds a Pending barcode', 'authenticated', U2, `select * from public.known_barcodes(array['${P}', '4800016644818', '4800777123454'])`, (r) => r.rows.length === 2);
await refused('logged-out phone calls known_barcodes', 'anon', null, `select * from public.known_barcodes(array['${P}'])`);
await ok('Dairy & eggs is a category', 'authenticated', U2, `insert into public.products (barcode, name, category) values ('4800777123454', 'Eden Cheese 165g', 'dairy & eggs')`);
await refused('unknown category', 'authenticated', U2, `insert into public.products (barcode, name, category) values ('4800016644115', 'X', 'snacks')`);
await refused('old category id (before Nov 11)', 'authenticated', U2, `insert into public.products (barcode, name, category) values ('4800016644115', 'X', 'dairy')`);
await ok('unsorted product has no category', 'authenticated', U2, `insert into public.products (barcode, name, category) values ('4800016644122', 'Mystery', null)`);
await db.exec(`update public.products set status = 'published' where barcode = '${P}'`);
await ok('Published, other shoppers see it', 'authenticated', U2, `select name from public.products where barcode = '${P}'`, (r) => r.rows.length === 1);

// Product images: set in the dashboard, readable by anyone, never set by the app.
await db.exec(`update public.products set image_path = '4800016644818.jpg', status = 'published' where barcode = '4800016644818'`);
await ok('logged-out phone reads a product image name', 'anon', null, `select image_path from public.products where barcode = '4800016644818'`, (r) => r.rows[0]?.image_path === '4800016644818.jpg');
await refused('app sets an image when adding a product', 'authenticated', U1, `insert into public.products (barcode, name, image_path) values ('4800016644115', 'X', 'x.jpg')`);
await refused('app changes a product image', 'authenticated', U1, `update public.products set image_path = 'other.jpg'`);
await refused('image name with a path trick', 'postgres', null, `update public.products set image_path = '../secret' where barcode = '4800016644818'`);
await ok('image bucket is public', 'postgres', null, `select public from storage.buckets where id = 'product-images'`, (r) => r.rows[0]?.public === true);
await refused('app uploads an image file', 'authenticated', U1, `insert into storage.objects (bucket_id, name) values ('product-images', 'x.jpg')`);
await refused('logged-out phone uploads an image file', 'anon', null, `insert into storage.objects (bucket_id, name) values ('product-images', 'y.jpg')`);

// One barcode form (006): UPC-A is 12 digits, never 13 with a leading 0.
await refused('UPC-A written as 13 digits', 'authenticated', U1, `insert into public.products (barcode, name) values ('0024000010623', 'Del Monte peaches')`);
await ok('UPC-A as 12 digits', 'authenticated', U1, `insert into public.products (barcode, name, size) values ('024000010623', 'Del Monte Sliced Peaches', '825g')`);
// Replay the Nov 8 dev data: a 13-digit twin with a photo, and a lone 13-digit row with a price.
await db.exec(`
  alter table public.products drop constraint products_barcode_upca_12;
  insert into public.products (barcode, name, image_path) values ('0024000010623', 'Del Monte Yellow Cling Peach Halves', '0024000010623.jpg');
  insert into public.products (barcode, name) values ('0024000163022', 'Del Monte Whole Kernel Corn');
  insert into public.price_sightings (client_id, barcode, branch_id, seen_on, price_type, unit_price_centavos, capture_method)
    values ('c0000000-0000-4000-8000-000000000060', '0024000163022', '${B1}', '${today}', 'each', 5250, 'tag');
`);
await db.exec(readFileSync(new URL('./migrations/006_one_barcode_form.sql', import.meta.url), 'utf8'));
await ok('006: twin merged, 12-digit name kept, photo added', 'postgres', null, `select name, size, image_path from public.products where barcode = '024000010623'`,
  (r) => r.rows[0]?.name === 'Del Monte Sliced Peaches' && r.rows[0]?.size === '825g' && r.rows[0]?.image_path === '0024000010623.jpg');
await ok('006: lone 13-digit row moved to 12 digits with its price', 'postgres', null,
  `select count(*)::int n from public.price_sightings where barcode = '024000163022'`, (r) => r.rows[0]?.n === 1);
await ok('006: no 13-digit 0 rows left', 'postgres', null, `select count(*)::int n from public.products where char_length(barcode) = 13 and barcode like '0%'`, (r) => r.rows[0]?.n === 0);
await refused('006: check is back on', 'postgres', null, `insert into public.products (barcode, name) values ('0024000010920', 'X')`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
