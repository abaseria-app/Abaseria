import { useState } from 'react';
import { S } from '../strings';
import { isMissingEmail, startSignIn, type Provider } from '../lib/auth';

interface Props {
  /** Coming back from Google or Facebook: the app is finishing the sign-in. */
  finishing: boolean;
  /** Why the last return from sign-in didn't work, if it didn't. */
  error: string | null;
}

const LOGO = `${import.meta.env.BASE_URL}icons/icon-192.png`;
const PRIVACY = `${import.meta.env.BASE_URL}privacy.html`;

const returnMessage = (error: string) => (isMissingEmail(error) ? S.login.noEmail : S.login.returned(error));

export function Login({ finishing, error }: Props) {
  const [going, setGoing] = useState<Provider | null>(null);
  const [msg, setMsg] = useState<string | null>(error ? returnMessage(error) : null);

  async function go(provider: Provider) {
    setGoing(provider);
    setMsg(null);
    const r = await startSignIn(provider);
    // On success the page is leaving for the provider, so the button stays in its "opening" state.
    if (r.ok) return;
    setGoing(null);
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
        <div className="login-buttons">
          <button className="btn primary huge" disabled={!!going} onClick={() => go('google')}>
            {going === 'google' ? S.login.going('google') : S.login.google}
          </button>
          <button className="btn facebook huge" disabled={!!going} onClick={() => go('facebook')}>
            {going === 'facebook' ? S.login.going('facebook') : S.login.facebook}
          </button>
        </div>
      )}
      {msg && <p className="hint login-error" role="alert">{msg}</p>}
      <p className="hint small">{S.login.why}</p>
      <a className="hint small login-privacy" href={PRIVACY}>{S.login.privacy}</a>
    </main>
  );
}
