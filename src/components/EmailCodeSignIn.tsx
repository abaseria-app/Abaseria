// Email code sign-in: type an address, get a 6-digit code by email, type the code. See auth.ts for why it's a
// code and not a link. On success auth.ts tells the app, which leaves the sign-in screen by itself.
import { useEffect, useState } from 'react';
import { S } from '../strings';
import {
  cleanCode,
  clearPendingCode,
  isEmail,
  pendingCode,
  sendEmailCode,
  verifyEmailCode,
  type CodeProblem,
} from '../lib/auth';

/** Supabase refuses a second code to the same address within 60 seconds (its default); match it on screen. */
const RESEND_SECONDS = 60;

interface Props {
  onBack: () => void;
}

export function EmailCodeSignIn({ onBack }: Props) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  const [resent, setResent] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Back from Gmail after Android closed the app: the code box is still waiting.
  useEffect(() => {
    let live = true;
    pendingCode().then((p) => {
      if (!live || !p) return;
      setEmail(p.email);
      setSentTo(p.email);
      setSentAt(p.sentAt);
    });
    return () => { live = false; };
  }, []);

  // Ticks the "send a new code in 42s" countdown.
  useEffect(() => {
    if (!sentTo) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sentTo]);

  const waitLeft = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));

  async function send(again: boolean) {
    setBusy('send');
    setProblem(null);
    setResent(false);
    const r = await sendEmailCode(again && sentTo ? sentTo : email);
    setBusy(null);
    if (!r.ok) return setProblem(r.problem);
    const t = Date.now();
    setSentTo((again && sentTo) || email.trim().toLowerCase());
    setSentAt(t);
    setNow(t);
    setCode('');
    setResent(again);
  }

  async function verify() {
    if (!sentTo) return;
    setBusy('verify');
    setProblem(null);
    const r = await verifyEmailCode(sentTo, code);
    // On success the app switches screens; keep the button in its "Checking…" state until it does.
    if (r.ok) return;
    setBusy(null);
    setProblem(r.problem);
  }

  async function otherEmail() {
    await clearPendingCode();
    setSentTo(null);
    setCode('');
    setProblem(null);
    setResent(false);
  }

  return (
    <div className="login-buttons email-code">
      <h2>{S.emailCode.title}</h2>
      {!sentTo ? (
        <form className="email-code-form" onSubmit={(e) => { e.preventDefault(); if (isEmail(email)) send(false); else setProblem('badEmail'); }}>
          <label htmlFor="signin-email">{S.emailCode.label}</label>
          <input
            id="signin-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={S.emailCode.placeholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy === 'send'}
          />
          <button className="btn primary huge" type="submit" disabled={busy === 'send' || !email.trim()}>
            {busy === 'send' ? S.emailCode.sending : S.emailCode.send}
          </button>
          <button className="btn secondary wide" type="button" onClick={onBack}>{S.emailCode.back}</button>
        </form>
      ) : (
        <form className="email-code-form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="hint">{S.emailCode.sentTo(sentTo)}</p>
          <label htmlFor="signin-code">{S.emailCode.codeLabel}</label>
          <input
            id="signin-code"
            className="code-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            disabled={busy === 'verify'}
          />
          <button className="btn primary huge" type="submit" disabled={busy !== null || code.length !== 6}>
            {busy === 'verify' ? S.emailCode.verifying : S.emailCode.verify}
          </button>
          {resent && <p className="hint" role="status">{S.emailCode.resent}</p>}
          <button className="btn secondary wide" type="button" disabled={busy !== null || waitLeft > 0} onClick={() => send(true)}>
            {waitLeft > 0 ? S.emailCode.resendIn(waitLeft) : busy === 'send' ? S.emailCode.sending : S.emailCode.resend}
          </button>
          <button className="link" type="button" onClick={otherEmail}>{S.emailCode.otherEmail}</button>
        </form>
      )}
      {problem && <p className="hint login-error" role="alert">{S.emailCode.problems[problem]}</p>}
    </div>
  );
}
