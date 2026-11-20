// security-alert: receives alerts from the database (security.alert, via pg_net) and emails them to Brad.
//
// Secrets (Edge Functions → Secrets):
//   ALERT_SECRET    must match the vault secret 'alert_secret'; anything without it is refused
//   RESEND_API_KEY  from resend.com (free plan). Without a verified domain Resend only delivers to the
//                   email address the Resend account was opened with, which is fine for alerts.
//   ALERT_TO        where alerts go: that same address
//   ALERT_FROM      optional; defaults to Resend's test sender
//
// Deployed with JWT verification off: the database calls it with ALERT_SECRET instead.

const PLAN = 'Breach Plan: claude/Abaseria_Breach_Plan.md in the Abaseria project.';

type Alert = { id?: number; kind: string; detail: Record<string, unknown>; at?: string };

function explain(a: Alert): { subject: string; lines: string[] } {
  const d = a.detail ?? {};
  switch (a.kind) {
    case 'price_flood':
      return {
        subject: `One account added ${d.prices_today} prices today`,
        lines: [
          `Account ${d.user_id} has added ${d.prices_today} prices today (alert line: ${d.alert_at}; refused after ${d.block_at}).`,
          'A collector on a big visit can do this. A troll or a rival store can too.',
          'Look at what they added (SQL editor):',
          `  select barcode, branch_id, unit_price_centavos, seen_on from public.price_sightings where contributor = '${d.user_id}' order by id desc limit 50;`,
          'If the prices are fake, pause the account. Its prices disappear from the app at once:',
          `  insert into security.paused_accounts (user_id, reason) values ('${d.user_id}', 'fake prices');`,
        ],
      };
    case 'price_limit_reached':
      return {
        subject: `Account hit the daily price limit (${d.prices_today})`,
        lines: [
          `Account ${d.user_id} reached ${d.prices_today} prices today. ${d.note ?? ''}`,
          'Check their prices and pause the account if they look fake (see the price_flood email for the SQL).',
        ],
      };
    case 'price_flood_all':
      return {
        subject: `${d.prices_today} prices added today across all accounts`,
        lines: [
          `All shoppers together added ${d.prices_today} prices today (alert line: ${d.alert_at}).`,
          'Good news if the app is growing. If not, many accounts may be posting fake prices together.',
          'Top accounts today:',
          `  select user_id, n from security.daily_counts where day = security.today() order by n desc limit 10;`,
        ],
      };
    case 'rows_deleted':
    case 'table_emptied':
      return {
        subject: `URGENT: data deleted from ${d.table}`,
        lines: [
          a.kind === 'rows_deleted'
            ? `${d.rows} row(s) were deleted from ${d.table} by database role "${d.db_role}".`
            : `Table ${d.table} was emptied (TRUNCATE) by database role "${d.db_role}".`,
          'The app can never delete. Only the SQL editor, a migration, or someone holding a secret key can.',
          'If this was you, ignore this email (next time start the script with: set local abaseria.maintenance = \'on\';).',
          `If it wasn't you: this is a breach. Start hour 0 of the ${PLAN}`,
        ],
      };
    case 'watched_table_changed':
      return {
        subject: `${d.table} changed (${d.operation})`,
        lines: [
          `${d.operation} on ${d.table} by database role "${d.db_role}"${d.by_account ? `, signed-in account ${d.by_account}` : ''}.`,
          `If you or another Admin didn't just do this, treat it as a breach: ${PLAN}`,
        ],
      };
    default:
      return { subject: a.kind, lines: ['Unrecognized alert kind. Details below.'] };
  }
}

// Tester feedback (migration 024). The alert carries only the feedback id; the message, sender and a 7-day
// screenshot link are read here with the server key, which Supabase gives every Edge Function.
async function feedbackEmail(a: Alert): Promise<{ subject: string; lines: string[] }> {
  const id = Number(a.detail?.feedback_id);
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const fallback = { subject: `New tester feedback #${id}`, lines: ['Open it in Table Editor → feedback.'] };
  if (!id || !base || !key) return fallback;
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    const rows = await (await fetch(`${base}/rest/v1/feedback?id=eq.${id}&select=*`, { headers: h })).json();
    const f = rows?.[0];
    if (!f) return fallback;
    const user = await (await fetch(`${base}/auth/v1/admin/users/${f.user_id}`, { headers: h })).json().catch(() => null);
    const meta = user?.user_metadata ?? {};
    const who = [meta.full_name ?? meta.name, user?.email].filter(Boolean).join(' · ') || f.user_id;
    let shot = 'none';
    if (f.screenshot_path) {
      const path = String(f.screenshot_path).split('/').map(encodeURIComponent).join('/');
      const signed = await (await fetch(`${base}/storage/v1/object/sign/feedback-screenshots/${path}`, {
        method: 'POST', headers: h, body: JSON.stringify({ expiresIn: 7 * 24 * 3600 }),
      })).json().catch(() => null);
      shot = signed?.signedURL ? `${base}/storage/v1${signed.signedURL} (link works for 7 days)` : `Storage → feedback-screenshots → ${f.screenshot_path}`;
    }
    const kind = String(f.kind).charAt(0).toUpperCase() + String(f.kind).slice(1);
    return {
      subject: `${kind} from ${meta.full_name ?? meta.name ?? user?.email ?? 'a tester'}${f.area ? ` (${f.area})` : ''}`,
      lines: [
        String(f.message),
        '',
        `From: ${who}`,
        `Where: ${f.area ?? 'not said'} · ${f.app_env === 'prod' ? 'live app' : 'test (dev) app'} · build ${f.app_build ?? '?'}`,
        `Phone: ${f.device ?? '?'} · screen ${f.screen ?? '?'}`,
        `Screenshot: ${shot}`,
        '',
        `Mark it handled: update public.feedback set status = 'seen', staff_note = '...' where id = ${id};`,
      ],
    };
  } catch (e) {
    console.error('feedback lookup failed', e);
    return fallback;
  }
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get('ALERT_SECRET') ?? '';
  const given = req.headers.get('x-alert-secret') ?? '';
  if (req.method !== 'POST' || !expected || !sameSecret(given, expected)) {
    return new Response('Not found', { status: 404 });
  }

  let alert: Alert;
  try {
    alert = await req.json();
    if (typeof alert?.kind !== 'string') throw new Error('no kind');
  } catch {
    return new Response('Bad alert', { status: 400 });
  }

  const ref = (Deno.env.get('SUPABASE_URL') ?? '').match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? 'unknown';
  const project = ref === 'xjztzqwyzkfzvgizlucc' ? 'PROD' : ref === 'psffjwaezfspmbebqbgg' ? 'dev' : ref;
  const { subject, lines } = alert.kind === 'tester_feedback' ? await feedbackEmail(alert) : explain(alert);
  const text = [
    ...lines,
    '',
    `Project: abaseria-${project.toLowerCase()} (${ref})`,
    `Time: ${alert.at ?? new Date().toISOString()}`,
    `Alert #${alert.id ?? '?'} is in security.events. Details:`,
    JSON.stringify(alert.detail, null, 2),
  ].join('\n');
  console.log(`[${project}] ${alert.kind}: ${subject}`);

  const key = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('ALERT_TO');
  if (!key || !to) {
    console.warn('RESEND_API_KEY or ALERT_TO not set; alert logged only.');
    return new Response('Logged; email not set up', { status: 503 });
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('ALERT_FROM') ?? 'Abaseria alerts <onboarding@resend.dev>',
      to: [to],
      subject: `[Abaseria ${project}] ${subject}`,
      text,
    }),
  });
  if (!res.ok) {
    console.error('Resend refused the email', res.status, await res.text());
    return new Response('Email failed', { status: 502 });
  }
  return new Response('Sent', { status: 200 });
});
