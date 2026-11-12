// Nightly attacker test. Talks to a live Supabase project with only the publishable key, the way a stranger
// who read this public repo would, and tries things the rules in supabase/schema.sql must refuse.
// npm run test:schema checks the rules as written; this checks what is actually live, so drift shows up.
//
// Usage: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node scripts/attacker-test.mjs
// Exit code 1 on any failure. In GitHub Actions a failed scheduled run emails the repo owner.
//
// Writes are built so they change nothing even if a rule is broken: filters that match no row, or values a
// check constraint refuses. The one exception is the storage upload: if it succeeds, the file it leaves behind
// (zz-attacker-test-should-fail.png) is the evidence.

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const NAME = process.env.PROJECT_NAME ?? 'project';
if (!URL_ || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  process.exit(2);
}
if (/^sb_secret_|service_role/.test(KEY)) {
  console.error('That is a secret key. This test must run with the publishable key only.');
  process.exit(2);
}

// Tables the app is meant to see through the API. A new exposed table fails the run until it's reviewed
// and added here (with its own refusal checks below).
const EXPOSED_OK = new Set(['branches', 'products', 'price_sightings', 'latest_prices', 'notices', 'known_barcodes']);
// Planned private tables (Shopper Profile Spec, Module 2, Module 4). Not built yet is fine; readable rows is not.
const PRIVATE_TABLES = ['shopper_profiles', 'consents', 'trips', 'trip_items', 'staff', 'collection_visits', 'product_import'];

const base = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(URL_ + path, {
    method,
    headers: { ...base, ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, text: text.slice(0, 200) };
}
const code = (r) => r.json?.code ?? r.json?.error ?? '';
// Refused: no privilege, not signed in, schema not exposed, the table/function doesn't exist (yet),
// or (55000) the view can't be written through at all.
const isRefused = (r) => r.status === 401 || r.status === 403 || ['42501', '55000', 'PGRST106', 'PGRST205', 'PGRST202'].includes(code(r));

let pass = 0;
const failures = [];
function result(ok, name, r) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}  →  HTTP ${r?.status} ${r?.text ?? ''}`); }
}
async function mustWork(name, path, check = (r) => r.status === 200) {
  const r = await call(path); result(check(r), name, r);
}
async function mustRefuse(name, path, opts) {
  const r = await call(path, opts); result(isRefused(r), name, r);
}

console.log(`Attacker test against ${NAME} (${URL_})\n`);

// 1. The test is talking to a working project with a valid key. Without these, a wrong key would make every
//    refusal below pass.
await mustWork('app can read products', '/rest/v1/products?select=barcode&limit=1');
await mustWork('app can read latest prices', '/rest/v1/latest_prices?select=barcode&limit=1');
await mustWork('app can read branches', '/rest/v1/branches?select=id&limit=1');

// 2. Who added what stays hidden.
await mustRefuse('price contributor hidden', '/rest/v1/price_sightings?select=contributor&limit=1');
await mustRefuse('product created_by hidden', '/rest/v1/products?select=created_by&limit=1');
await mustRefuse('branch created_by hidden', '/rest/v1/branches?select=created_by&limit=1');
await mustRefuse('select * on products refused (hidden column)', '/rest/v1/products?select=*&limit=1');
await mustRefuse('select * on branches refused (hidden column)', '/rest/v1/branches?select=*&limit=1');

// 3. Logged-out writes. Filters match nothing and values break check constraints, so a broken rule still
//    changes no data: a 2xx or a constraint error means the request got past the permission check.
const write = (path, method, body) => ({ path, opts: { method, body, headers: { Prefer: 'return=minimal' } } });
for (const [name, w] of [
  ['add a store', write('/rest/v1/branches', 'POST', { id: crypto.randomUUID(), chain: '', name: '' })],
  ['add a product', write('/rest/v1/products', 'POST', { barcode: '0', name: '' })],
  ['add a price', write('/rest/v1/price_sightings', 'POST', { client_id: crypto.randomUUID(), barcode: '0', branch_id: crypto.randomUUID(), seen_on: '2000-01-01', price_type: 'x', unit_price_centavos: 0, capture_method: 'x' })],
  ['edit a product', write('/rest/v1/products?barcode=eq.attacker-test-none', 'PATCH', { name: 'x' })],
  ['edit a price', write('/rest/v1/price_sightings?id=eq.-1', 'PATCH', { unit_price_centavos: 1 })],
  ['delete a price', write('/rest/v1/price_sightings?id=eq.-1', 'DELETE')],
  ['delete a product', write('/rest/v1/products?barcode=eq.attacker-test-none', 'DELETE')],
  ['delete a store', write('/rest/v1/branches?id=eq.00000000-0000-4000-8000-000000000000', 'DELETE')],
  ['write through latest_prices', write('/rest/v1/latest_prices', 'POST', { barcode: '0' })],
  ['add a notice', write('/rest/v1/notices', 'POST', { title_en: '' })],
  ['edit a notice', write('/rest/v1/notices?id=eq.-1', 'PATCH', { title_en: 'x' })],
  ['delete a notice', write('/rest/v1/notices?id=eq.-1', 'DELETE')],
  ['logged-out known_barcodes call', write('/rest/v1/rpc/known_barcodes', 'POST', { codes: ['0'] })],
  // Staff roles (013). The role 'x' and the made-up account break the table's checks, so even a broken rule adds no one.
  ['make itself staff', write('/rest/v1/staff', 'POST', { user_id: crypto.randomUUID(), role: 'x' })],
  ['promote a staff member', write('/rest/v1/staff?user_id=eq.00000000-0000-4000-8000-000000000000', 'PATCH', { role: 'admin' })],
  ['switch a collector\'s trust', write('/rest/v1/staff?user_id=eq.00000000-0000-4000-8000-000000000000', 'PATCH', { trusted: true })],
  ['remove a staff member', write('/rest/v1/staff?user_id=eq.00000000-0000-4000-8000-000000000000', 'DELETE')],
  ['call is_admin()', write('/rest/v1/rpc/is_admin', 'POST', {})],
  ['call is_staff()', write('/rest/v1/rpc/is_staff', 'POST', {})],
  ['call staff_role()', write('/rest/v1/rpc/staff_role', 'POST', {})],
]) await mustRefuse(`logged out: ${name}`, w.path, w.opts);

// 4. Private tables: not built yet (404) is fine, refused is fine, empty is fine. Any row is a leak.
for (const t of PRIVATE_TABLES) {
  const r = await call(`/rest/v1/${t}?select=*&limit=1`);
  const notBuilt = r.status === 404 || code(r) === 'PGRST205' || code(r) === '42P01';
  const empty = r.status === 200 && Array.isArray(r.json) && r.json.length === 0;
  result(notBuilt || isRefused(r) || empty, `private table ${t}: no rows readable${notBuilt ? ' (not built yet)' : ''}`, r);
}

// Staff roles (013): logged out, the table is refused outright, not just empty.
await mustRefuse('logged out: read staff', '/rest/v1/staff?select=user_id&limit=1');

// 5. The security schema (alerts, counters, paused accounts) is never reachable through the API.
await mustRefuse('security schema not exposed', '/rest/v1/events?select=*&limit=1', { headers: { 'Accept-Profile': 'security' } });

// 6. Only the expected tables are exposed. The API's table list isn't always served to the publishable key;
//    when it isn't, the private-table checks above still run.
{
  const r = await call('/rest/v1/');
  if (r.status === 200 && r.json?.paths) {
    const exposed = Object.keys(r.json.paths).map((p) => p.replace(/^\/(rpc\/)?/, '')).filter(Boolean);
    const extra = exposed.filter((t) => !EXPOSED_OK.has(t));
    result(extra.length === 0, `no unexpected tables exposed${extra.length ? ` (found: ${extra.join(', ')})` : ''}`, r);
  } else {
    console.log(`SKIP  exposed-table list (HTTP ${r.status}; not served to the publishable key)`);
  }
}

// 7. Storage: product images can't be listed or uploaded by the app's key.
{
  const r = await call('/storage/v1/object/list/product-images', { method: 'POST', body: { prefix: '', limit: 5 } });
  const listed = r.status === 200 && Array.isArray(r.json) && r.json.length > 0;
  result(!listed, 'product-images bucket cannot be listed', r);
}
{
  const r = await call('/storage/v1/object/product-images/zz-attacker-test-should-fail.png', {
    method: 'POST', headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
  result(r.status >= 400, 'logged out: upload a product image', r);
}

// 8. Auth admin endpoints refuse the publishable key.
await mustRefuse('list all accounts (auth admin)', '/auth/v1/admin/users');

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\nWhat to do: open the Breach Plan (claude/Abaseria_Breach_Plan.md). A failure here means a rule is
looser than schema.sql says. Check whether a recent migration or dashboard change caused it, fix it, and
judge from the API logs (Free plan: last 24 hours only) whether anyone used the gap.`);
  process.exit(1);
}
