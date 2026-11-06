import { useState } from 'react';
import { S } from '../strings';
import { startGoogle } from '../lib/auth';

interface Props {
  /** Coming back from Google: the app is finishing the sign-in. */
  finishing: boolean;
  /** Why the last return from Google didn't work, if it didn't. */
  error: string | null;
}

const LOGO = `${import.meta.env.BASE_URL}icons/icon-192.png`;

export function Login({ finishing, error }: Props) {
  const [going, setGoing] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ? S.login.returned(error) : null);

  async function go() {
    setGoing(true);
    setMsg(null);
    const r = await startGoogle();
    // On success the page is leaving for Google, so the button stays in its "opening" state.
    if (r.ok) return;
    setGoing(false);
    setMsg(r.reason === 'offline' ? S.login.offline : r.reason === 'off' ? S.login.off : S.login.failed(r.message ?? ''));
  }

  return (
    <main className="screen login">
      <img className="login-logo" src={LOGO} alt="Abaseria" width={120} height={120} />
      <h1>{S.login.title}</h1>
      <p className="login-pitch">{S.login.pitch}</p>
      {finishing ? (
        <p className="hint login-status">{S.login.finishing}</p>
      ) : (
        <button className="btn primary huge" disabled={going} onClick={go}>
          {going ? S.login.going : S.login.google}
        </button>
      )}
      {msg && <p className="hint login-error" role="alert">{msg}</p>}
      <p className="hint small">{S.login.why}</p>
    </main>
  );
}
