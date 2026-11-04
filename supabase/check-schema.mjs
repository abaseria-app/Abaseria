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
  -- Stand-in for Supabase Storage: just the columns the policies use. Supabase turns on RLS for objects itself.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid());
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
await refused('edit a sighting', 'authenticated', U1, `update public.price_sightings set unit_price_centavos = 1`);
await refused('delete a sighting', 'authenticated', U1, `delete from public.price_sightings`);
await refused('edit a product', 'authenticated', U1, `update public.products set name = 'x'`);

// Product photos: the row first, then the file at its path; pending until published.
const P1 = 'f0000000-0000-4000-8000-000000000001';
const P2 = 'f0000000-0000-4000-8000-000000000002';
const path = (id) => `4800016644818/${id}.jpg`;
const file = (id, bucket = 'product-photos') => `insert into storage.objects (bucket_id, name) values ('${bucket}', '${path(id)}')`;
await ok('signed-in phone adds a photo row', 'authenticated', U1, `insert into public.product_photos (id, barcode) values ('${P1}', '4800016644818')`);
await ok('then uploads the file at that path', 'authenticated', U1, file(P1));
await refused('file at a path with no row', 'authenticated', U1, file('f0000000-0000-4000-8000-00000000000f'));
await refused('second photo of the same barcode from one phone', 'authenticated', U1, `insert into public.product_photos (id, barcode) values (gen_random_uuid(), '4800016644818')`);
await refused('photo row that claims to be published', 'authenticated', U2, `insert into public.product_photos (id, barcode, status) values ('${P2}', '4800016644818', 'published')`);
await refused('logged-out phone adds a photo row', 'anon', null, `insert into public.product_photos (id, barcode) values (gen_random_uuid(), '4800016644818')`);
await refused('photo of an unknown barcode', 'authenticated', U2, `insert into public.product_photos (id, barcode) values (gen_random_uuid(), '4800016644115')`);
await ok('uploader sees its own pending photo', 'authenticated', U1, `select path from public.product_photos`, (r) => r.rows.length === 1);
await ok('another phone sees no pending photo', 'authenticated', U2, `select path from public.product_photos`, (r) => r.rows.length === 0);
await ok('logged-out phone sees no pending file', 'anon', null, `select name from storage.objects`, (r) => r.rows.length === 0);
await ok('another phone adds its own photo row', 'authenticated', U2, `insert into public.product_photos (id, barcode) values ('${P2}', '4800016644818')`);
await refused("upload into someone else's pending path", 'authenticated', U2, file(P1));
await refused('photo uploader column hidden', 'anon', null, `select created_by from public.product_photos`);
await refused('publish a photo from the app', 'authenticated', U1, `update public.product_photos set status = 'published'`);
await refused('delete a photo row from the app', 'authenticated', U1, `delete from public.product_photos`);
await refused('swap a photo file', 'authenticated', U1, `update storage.objects set name = 'x'`);
await refused('delete a photo file', 'authenticated', U1, `delete from storage.objects`);
await db.exec(`update public.product_photos set status = 'published' where id = '${P1}'`);
await ok('published photo row is readable logged out', 'anon', null, `select path from public.product_photos where status = 'published'`, (r) => r.rows[0]?.path === path(P1));
await ok('published photo file is readable logged out', 'anon', null, `select name from storage.objects`, (r) => r.rows.length === 1 && r.rows[0].name === path(P1));
await refused('upload a second file once the row is published', 'authenticated', U1, file(P1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
