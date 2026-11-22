import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';
import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  FeedbackError,
  MESSAGE_MAX,
  messageOk,
  sendFeedback,
  shrinkScreenshot,
  type FeedbackArea,
  type FeedbackKind,
} from '../lib/feedback';

interface Props {
  onBack: () => void;
}

export function Feedback({ onBack }: Props) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [area, setArea] = useState<FeedbackArea | null>(null);
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const reset = () => {
    setKind(null);
    setArea(null);
    setMessage('');
    setShot(null);
    setPreview(null);
    setError(null);
    setTried(false);
    setSent(false);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      const small = await shrinkScreenshot(file);
      setShot(small);
      setPreview(URL.createObjectURL(small));
    } catch {
      setError(S.feedback.shotBad);
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async () => {
    setTried(true);
    if (!kind || !messageOk(message)) return;
    setError(null);
    setSending(true);
    try {
      await sendFeedback({ kind, area, message, screenshot: shot });
      setSent(true);
    } catch (e) {
      const reason = e instanceof FeedbackError ? e.reason : 'failed';
      if (!(e instanceof FeedbackError)) console.warn('feedback failed', e);
      setError(S.feedback.errors[reason] ?? S.feedback.errors.failed);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <main className="screen feedback">
        <header className="topbar">
          <button className="link" onClick={onBack}>{S.feedback.back}</button>
          <h1>{S.feedback.title}</h1>
          <span className="spacer" />
        </header>
        <section className="card feedback-done">
          <h2>{S.feedback.doneTitle}</h2>
          <p>{S.feedback.doneText}</p>
          <button className="btn primary wide" onClick={reset}>{S.feedback.another}</button>
          <button className="btn secondary wide" onClick={onBack}>{S.feedback.done}</button>
        </section>
      </main>
    );
  }

  const trimmed = message.trim().length;
  return (
    <main className="screen feedback">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.feedback.back}</button>
        <h1>{S.feedback.title}</h1>
        <span className="spacer" />
      </header>

      <p className="hint">{S.feedback.intro}</p>

      <section className="card">
        <h2 id="fb-kind">{S.feedback.kindLabel}</h2>
        <div className="chips" role="radiogroup" aria-labelledby="fb-kind">
          {FEEDBACK_KINDS.map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {S.feedback.kinds[k]}
            </button>
          ))}
        </div>
        {tried && !kind && <p className="hint warn">{S.feedback.needKind}</p>}

        <label className="field">
          <span>{S.feedback.areaLabel}</span>
          <select className="filter-select" value={area ?? ''} onChange={(e) => setArea((e.target.value || null) as FeedbackArea | null)}>
            <option value="">{S.feedback.areaNone}</option>
            {FEEDBACK_AREAS.map((a) => (
              <option key={a} value={a}>{S.feedback.areas[a]}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{S.feedback.messageLabel}</span>
          <textarea
            rows={6}
            maxLength={MESSAGE_MAX}
            value={message}
            placeholder={S.feedback.placeholders[kind ?? 'problem']}
            onChange={(e) => setMessage(e.target.value)}
          />
          <small className="hint count">{S.feedback.count(message.length, MESSAGE_MAX)}</small>
        </label>
        {tried && trimmed < 3 && <p className="hint warn">{S.feedback.needMessage}</p>}
      </section>

      <section className="card">
        <h2>{S.feedback.shotLabel}</h2>
        {preview ? (
          <div className="feedback-shot">
            <img src={preview} alt={S.feedback.shotAlt} />
            <button className="btn secondary" onClick={() => { setShot(null); setPreview(null); }}>{S.feedback.shotRemove}</button>
          </div>
        ) : (
          <>
            <p className="hint">{S.feedback.shotHow}</p>
            <button className="btn secondary wide" disabled={preparing} onClick={() => fileRef.current?.click()}>
              {preparing ? S.feedback.shotPreparing : S.feedback.shotPick}
            </button>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </section>

      <p className="hint">{S.feedback.sentWith}</p>
      {error && <p className="hint warn" role="alert">{error}</p>}
      <button className="btn primary wide" disabled={sending || preparing} onClick={send}>
        {sending ? S.feedback.sending : S.feedback.send}
      </button>
    </main>
  );
}
