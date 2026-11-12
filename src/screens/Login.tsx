import { useEffect, useState } from 'react';
import { S } from '../strings';
import { isMissingEmail, pendingCode, startSignIn, type Provider } from '../lib/auth';
import { EmailCodeSignIn } from '../components/EmailCodeSignIn';
import { chromeIntentUrl, currentInAppBrowser, isAndroid, pageToOpen } from '../lib/inAppBrowser';

interface Props {
  /** Coming back from Google or Facebook: the app is finishing the sign-in. */
  finishing: boolean;
  /** Why the last return from sign-in didn't work, if it didn't. */
  error: string | null;
}

const LOGO = `${import.meta.env.BASE_URL}icons/icon-192.png`;
const PRIVACY = `${import.meta.env.BASE_URL}privacy.html`;

// Facebook sign-in is hidden until the Meta app is published (Nov 9): while it's unpublished, only people
// with a role on the Meta app can sign in, and everyone else hits Facebook's "Feature Unavailable" page.
// To test it anyway, open the app with ?facebook on the end of the address. To show it to everyone, set this to true.
const FACEBOOK_FOR_EVERYONE = false;
const showFacebook = () => FACEBOOK_FOR_EVERYONE || new URLSearchParams(window.location.search).has('facebook');

const returnMessage = (error: string) => (isMissingEmail(error) ? S.login.noEmail : S.login.returned(error));

// Google refuses sign-in inside Facebook's, Messenger's and Instagram's built-in browsers, so there the
// Google button is swapped for a way out to Chrome. Preview in a normal browser with ?inapp.
const inApp = currentInAppBrowser();
const android = typeof navigator !== 'undefined' && isAndroid(navigator.userAgent ?? '');

export function Login({ finishing, error }: Props) {
  const [going, setGoing] = useState<Provider | null>(null);
  const [msg, setMsg] = useState<string | null>(error ? returnMessage(error) : null);
  const [copy, setCopy] = useState<'copied' | 'failed' | null>(null);
  const [withEmail, setWithEmail] = useState(false);

  // A code was sent a few minutes ago and Android closed the app while the shopper read it: go straight back.
  useEffect(() => {
    let live = true;
    pendingCode().then((p) => { if (live && p) setWithEmail(true); });
    return () => { live = false; };
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageToOpen(window.location.href));
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

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
      ) : withEmail ? (
        <EmailCodeSignIn onBack={() => setWithEmail(false)} />
      ) : (
        <div className="login-buttons">
          {inApp ? (
            <>
              <p className="login-inapp" role="note">{S.inApp.why(S.inApp.apps[inApp])}</p>
              {android ? (
                <a className="btn primary huge" href={chromeIntentUrl(window.location.href)}>{S.inApp.openChrome}</a>
              ) : (
                <p className="hint">{S.inApp.otherPhone}</p>
              )}
              <button className="btn secondary wide" onClick={copyLink}>{S.inApp.copyLink}</button>
              {copy === 'copied' && <p className="hint" role="status">{S.inApp.copied}</p>}
              {copy === 'failed' && (
                <>
                  <p className="hint" role="status">{S.inApp.copyFailed}</p>
                  <input className="login-link" readOnly value={pageToOpen(window.location.href)} onFocus={(e) => e.currentTarget.select()} />
                </>
              )}
            </>
          ) : (
            <button className="btn primary huge" disabled={!!going} onClick={() => go('google')}>
              {going === 'google' ? S.login.going('google') : S.login.google}
            </button>
          )}
          <button className="btn secondary wide" disabled={!!going} onClick={() => { setMsg(null); setWithEmail(true); }}>
            {S.login.email}
          </button>
          {showFacebook() && (
            <button className="btn facebook huge" disabled={!!going} onClick={() => go('facebook')}>
              {going === 'facebook' ? S.login.going('facebook') : S.login.facebook}
            </button>
          )}
        </div>
      )}
      {msg && <p className="hint login-error" role="alert">{msg}</p>}
      <p className="hint small">{S.login.why}</p>
      <a className="hint small login-privacy" href={PRIVACY}>{S.login.privacy}</a>
    </main>
  );
}
