import { useEffect, useMemo, useState } from 'react';
import { S } from '../strings';
import { YearWheel } from './YearWheel';
import {
  CHOICES,
  ProfileFailure,
  birthYears,
  cleanNickname,
  loadProfile,
  saveAnswers,
  setConsent,
  type Answer,
  type ChoiceField,
  type Loaded,
  type ProfileError,
} from '../lib/profile';
import type { QuestionSet } from '../lib/visits';

/** One question per screen. Location joins the basics once the city list exists (task P3). */
export type Question = 'nickname' | 'birth_year' | ChoiceField;
const SETS: Record<QuestionSet, Question[]> = {
  basics: ['nickname', 'birth_year', 'gender'],
  household: ['household_size_band', 'has_kids_under_12', 'has_senior_60plus', 'payday_pattern', 'grocery_budget_band'],
};

/** Male first, as in the design. */
const GENDER_ORDER = ['man', 'woman', 'another', 'no_answer'];

type Screen = 'loading' | 'welcome' | Question | 'under18' | 'done';

interface Props {
  /** A whole set (on the 2nd or 3rd visit), or one question (Change on the Profile tab). */
  set?: QuestionSet;
  only?: Question;
  /** Google name, offered as a hint on the name question. */
  suggestedName?: string | null;
  /** Called once, when the first question is actually on screen (not if there was nothing left to ask). */
  onShown?: () => void;
  onClose: (latest: Loaded | null) => void;
}

const F = () => S.profile.flow;

function GenderIcon({ v }: { v: string }) {
  const common = { width: 34, height: 34, viewBox: '0 0 32 32', fill: 'none', strokeWidth: 3, strokeLinecap: 'round' as const, 'aria-hidden': true };
  if (v === 'man')
    return (
      <svg {...common} stroke="#1f7fd1"><circle cx="13" cy="19" r="8" /><path d="M19 13 27 5M20 5h7v7" /></svg>
    );
  if (v === 'woman')
    return (
      <svg {...common} stroke="#e0337f"><circle cx="16" cy="12" r="8" /><path d="M16 20v10M11 25h10" /></svg>
    );
  if (v === 'another')
    return (
      <svg {...common} stroke="#7a4fb0"><circle cx="16" cy="19" r="7" /><path d="M16 12V3M12 4.5l8 5M20 4.5l-8 5" /></svg>
    );
  return null;
}

export function QuestionFlow({ set, only, suggestedName, onShown, onClose }: Props) {
  const [data, setData] = useState<Loaded | null>(null);
  const [queue, setQueue] = useState<Screen[]>(['loading']);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ProfileError | null>(null);
  const [name, setName] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const years = useMemo(() => birthYears(), []);

  useEffect(() => {
    let live = true;
    loadProfile()
      .then((d) => {
        if (!live) return;
        setData(d);
        const p = d.profile;
        const asked = (only ? [only] : SETS[set ?? 'basics']).filter((q) => {
          if (q === 'birth_year') return !p.birth_year && !p.birthday_locked_at;
          return only ? true : p[q] == null;
        });
        if (!asked.length) {
          // Nothing left to ask in this set: count it as shown so it doesn't try again tomorrow.
          onShown?.();
          return onClose(d);
        }
        setName(p.nickname ?? '');
        const screens: Screen[] = [...(d.consents.profile ? [] : (['welcome'] as Screen[])), ...asked];
        setQueue(only ? screens : [...screens, 'done']);
        onShown?.();
      })
      .catch(() => live && onClose(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const screen = queue[at];
  const last = at >= queue.length - 1;
  // `latest` matters on the last screen: the answer just saved isn't in `data` until the next render,
  // so closing with `data` would hand back the profile from before the tap.
  const next = (latest: Loaded | null = data) => (last ? onClose(latest) : setAt((i) => i + 1));

  async function run(work: () => Promise<Loaded | void>) {
    setBusy(true);
    setError(null);
    try {
      const d = await work();
      if (d) setData(d);
      next(d || data);
    } catch (e) {
      setError(e instanceof ProfileFailure ? e.reason : 'failed');
    } finally {
      setBusy(false);
    }
  }

  const answer = (a: Answer) =>
    run(async () => {
      const profile = await saveAnswers(a);
      return data ? { ...data, profile } : undefined;
    });

  function body() {
    switch (screen) {
      case 'loading':
        return <p className="hint flow-center">{S.profile.loading}</p>;
      case 'welcome':
        return (
          <>
            <h2>{set === 'household' ? F().welcomeHousehold : F().welcomeBasics}</h2>
            <p className="flow-sub">{set === 'household' ? F().welcomeHouseholdText : F().welcomeBasicsText}</p>
            {/* Consent: both choices the same size and weight (NPC Advisory 2023-01 on deceptive design). */}
            <div className="flow-options">
              <button className="flow-option" disabled={busy} onClick={() => void run(() => setConsent('profile', true))}>
                {F().allowSave}
              </button>
              <button className="flow-option" disabled={busy} onClick={() => onClose(data)}>
                {F().notNow}
              </button>
            </div>
            <p className="flow-sub small">{F().allowSaveHint}</p>
          </>
        );
      case 'nickname':
        return (
          <>
            <h2>{F().nickname}</h2>
            <p className="flow-sub">{F().nicknameText}</p>
            <input
              className="flow-input"
              value={name}
              maxLength={30}
              placeholder={suggestedName?.split(' ')[0] || F().nicknamePlaceholder}
              autoComplete="nickname"
              enterKeyHint="next"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && cleanNickname(name) && void answer({ nickname: cleanNickname(name) })}
            />
            <button className="btn primary wide" disabled={busy || !cleanNickname(name)} onClick={() => void answer({ nickname: cleanNickname(name) })}>
              {F().next}
            </button>
          </>
        );
      case 'birth_year':
        return (
          <>
            <h2>{F().birthYear}</h2>
            <p className="flow-sub">{F().birthYearText}</p>
            <YearWheel years={years} start={years[0] - 16} value={year} onChange={setYear} label={F().birthYear} />
            <button className="btn primary wide" disabled={busy || year == null} onClick={() => year && void answer({ birth_year: year })}>
              {F().next}
            </button>
            <button className="link flow-under18" disabled={busy} onClick={() => setQueue((q) => [...q.slice(0, at + 1), 'under18'])}>
              {F().under18}
            </button>
          </>
        );
      case 'under18':
        return (
          <>
            <h2>{F().doneTitle}</h2>
            <p className="flow-sub">{F().under18Done}</p>
            <button className="btn primary wide" onClick={() => onClose(data)}>{F().close}</button>
          </>
        );
      case 'done':
        return (
          <>
            <h2>{F().doneTitle}</h2>
            <p className="flow-sub">{F().doneText}</p>
            <button className="btn primary wide" onClick={() => onClose(data)}>{F().done}</button>
          </>
        );
      default: {
        const field = screen as ChoiceField;
        const current = data?.profile[field];
        return (
          <>
            <h2>{F()[field as keyof ReturnType<typeof F>] as string}</h2>
            <p className="flow-sub">{F()[`${field}Text` as keyof ReturnType<typeof F>] as string}</p>
            <div className="flow-options">
              {(field === 'gender' ? GENDER_ORDER : CHOICES[field]).map((v) => (
                <button key={v} className={`flow-option ${current === v ? 'on' : ''}`} disabled={busy} onClick={() => void answer({ [field]: v })}>
                  {field === 'gender' && <GenderIcon v={v} />}
                  <span>{S.profile.labels[v] ?? v}</span>
                </button>
              ))}
            </div>
          </>
        );
      }
    }
  }

  const canSkip = screen !== 'loading' && screen !== 'done' && screen !== 'under18';
  const isQuestion = canSkip && screen !== 'welcome';
  return (
    <div className="flow-overlay" role="dialog" aria-modal="true" aria-label={S.profile.aboutYou}>
      <div className="flow-sheet">
        <div className="flow-top">
          {at > 0 && canSkip && queue[at - 1] !== 'welcome' ? (
            <button className="link" disabled={busy} onClick={() => setAt((i) => i - 1)}>{F().back}</button>
          ) : (
            <span />
          )}
          {queue.length > 2 && isQuestion && (
            <span className="flow-dots" aria-hidden="true">
              {queue.filter((s) => s !== 'done' && s !== 'welcome').map((s, i) => (
                <i key={i} className={s === screen ? 'on' : ''} />
              ))}
            </span>
          )}
          <button className="link" aria-label={F().close} onClick={() => onClose(data)}>✕</button>
        </div>
        <div className="flow-body">
          {body()}
          {error && <p className="hint profile-error" role="alert">{S.profile.errors[error]}</p>}
          {busy && <p className="hint">{F().saving}</p>}
        </div>
        {isQuestion && (
          <button className="flow-skip" disabled={busy} onClick={() => next()}>
            {F().skip}
          </button>
        )}
      </div>
    </div>
  );
}
