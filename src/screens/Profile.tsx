import { useEffect, useState } from 'react';
import { S } from '../strings';
import { BottomNav } from '../components/BottomNav';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { QuestionFlow, type Question } from '../components/QuestionFlow';
import type { Account } from '../lib/auth';
import {
  ProfileFailure,
  deleteAnswers,
  loadProfile,
  saveAnswers,
  setConsent,
  type Answer,
  type ChoiceField,
  type Loaded,
  type ProfileError,
  type Purpose,
} from '../lib/profile';

interface Props {
  account: Account | null;
  onExplore: () => void;
  onCart: () => void;
  onScan: () => void;
  onCommunity: () => void;
  onSettings: () => void;
}

type Editing = Question | null;
type Ask = 'turnOff' | 'removeYear' | 'deleteAll' | null;

const PRIVACY = `${import.meta.env.BASE_URL}privacy.html#profile`;
const CHOICE_FIELDS: ChoiceField[] = ['gender', 'household_size_band', 'has_kids_under_12', 'has_senior_60plus', 'payday_pattern', 'grocery_budget_band'];
const label = (v: string) => S.profile.labels[v] ?? v;

/** The Profile tab: the shopper's switches and answers, each one changeable or removable on the spot. */
export function Profile({ account, onExplore, onCart, onScan, onCommunity, onSettings }: Props) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<ProfileError | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run<T>(work: () => Promise<T>, done?: (v: T) => void) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const v = await work();
      done?.(v);
      return true;
    } catch (e) {
      setError(e instanceof ProfileFailure ? e.reason : 'failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const reload = () => run(loadProfile, setData);
  useEffect(() => {
    void reload();
    // Reload when the account changes (sign-out and in as someone else on the same phone).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  const flip = (purpose: Purpose, on: boolean) =>
    run(() => setConsent(purpose, on), (d) => {
      setData(d);
      setAsk(null);
    });

  const save = (answer: Answer) =>
    run(() => saveAnswers(answer), (profile) => {
      setData((d) => (d ? { ...d, profile } : d));
      setEditing(null);
      setAsk(null);
    });

  const nav = <BottomNav current="profile" onExplore={onExplore} onCart={onCart} onScan={onScan} onCommunity={onCommunity} onProfile={() => undefined} />;

  const errorLine = error && (
    <p className="hint profile-error" role="alert">
      {S.profile.errors[error]}
    </p>
  );

  if (!data) {
    return (
      <main className="screen explore with-nav profile">
        <header className="soon-header">
          <h1>{S.profile.title}</h1>
        </header>
        <div className="explore-body">
          {error ? (
            <section className="card">
              {errorLine}
              <button className="btn secondary wide" disabled={busy} onClick={() => void reload()}>{S.profile.retry}</button>
            </section>
          ) : (
            <p className="hint">{S.profile.loading}</p>
          )}
        </div>
        {nav}
      </main>
    );
  }

  const { consents, profile } = data;

  function row(field: ChoiceField) {
    const value = profile[field];
    return (
      <div className="profile-row" key={field}>
        <div className="profile-q">
          <strong>{S.profile.questions[field]}</strong>
          <small>{S.profile.why[field]}</small>
          <span className={value ? 'profile-a' : 'profile-a empty'}>{value ? label(value) : S.profile.notAnswered}</span>
        </div>
        <div className="profile-actions">
          <button className="link" disabled={busy} onClick={() => setEditing(field)}>{value ? S.profile.edit : S.profile.answer}</button>
          {value && <button className="link danger" disabled={busy} onClick={() => void save({ [field]: null })}>{S.profile.remove}</button>}
        </div>
      </div>
    );
  }

  const yearLocked = !!profile.birthday_locked_at;
  const yearRow = (
    <div className="profile-row">
      <div className="profile-q">
        <strong>{S.profile.questions.birth_year}</strong>
        <small>{S.profile.why.birth_year}</small>
        <span className={profile.birth_year ? 'profile-a' : 'profile-a empty'}>{profile.birth_year ?? S.profile.notAnswered}</span>
        {profile.birth_year && <small>{S.profile.yearLocked}</small>}
      </div>
      {ask === 'removeYear' ? (
        <div className="account-actions">
          <p>{S.profile.yearRemoveAsk}</p>
          <button className="btn danger-link" disabled={busy} onClick={() => void save({ birth_year: null })}>{S.profile.remove}</button>
          <button className="btn secondary wide" onClick={() => setAsk(null)}>{S.profile.cancel}</button>
        </div>
      ) : (
        <div className="profile-actions">
          {/* A removed year can only come back through support, so "Answer" shows only before the first save. */}
          {!profile.birth_year && !yearLocked && (
            <button className="link" disabled={busy} onClick={() => setEditing('birth_year')}>{S.profile.answer}</button>
          )}
          {!profile.birth_year && yearLocked && <small>{S.profile.yearLocked}</small>}
          {profile.birth_year && <button className="link danger" disabled={busy} onClick={() => setAsk('removeYear')}>{S.profile.remove}</button>}
        </div>
      )}
    </div>
  );

  const nicknameRow = (
    <div className="profile-row">
      <div className="profile-q">
        <strong>{S.profile.questions.nickname}</strong>
        <small>{S.profile.why.nickname}</small>
        <span className={profile.nickname ? 'profile-a' : 'profile-a empty'}>{profile.nickname ?? S.profile.notAnswered}</span>
      </div>
      <div className="profile-actions">
        <button className="link" disabled={busy} onClick={() => setEditing('nickname')}>{profile.nickname ? S.profile.edit : S.profile.answer}</button>
        {profile.nickname && <button className="link danger" disabled={busy} onClick={() => void save({ nickname: null })}>{S.profile.remove}</button>}
      </div>
    </div>
  );

  const hasLocation = !!(profile.province_code || profile.city_code);
  const locationRow = (
    <div className="profile-row">
      <div className="profile-q">
        <strong>{S.profile.questions.location}</strong>
        <small>{S.profile.why.location}</small>
        <span className={hasLocation ? 'profile-a' : 'profile-a empty'}>{hasLocation ? S.profile.locationSaved : S.profile.notAnswered}</span>
        {!hasLocation && <small>{S.profile.locationLater}</small>}
      </div>
      {hasLocation && (
        <div className="profile-actions">
          <button className="link danger" disabled={busy} onClick={() => void save({ province_code: null, city_code: null })}>{S.profile.remove}</button>
        </div>
      )}
    </div>
  );

  const hasAnswers = Object.entries(profile).some(([k, v]) => k !== 'birthday_locked_at' && v !== null);

  return (
    <main className="screen explore with-nav profile">
      <header className="soon-header">
        <h1>{S.profile.title}</h1>
        <button className="link" onClick={onSettings}>{S.profile.settings}</button>
      </header>
      <div className="explore-body">
        {account && <ProfilePhoto account={account} />}
        {profile.nickname && <p className="profile-hello">{S.profile.hello(profile.nickname)}</p>}
        {editing && (
          <QuestionFlow
            only={editing}
            suggestedName={account?.name}
            onClose={(latest) => {
              setEditing(null);
              if (latest) setData(latest);
            }}
          />
        )}
        {errorLine}
        {note && <p className="hint" role="status">{note}</p>}

        <section className="card">
          <h2>{S.profile.aboutYou}</h2>
          <p className="hint">{S.profile.aboutYouHint}</p>
          <a className="hint small" href={PRIVACY}>{S.profile.privacyLink}</a>
          {ask === 'turnOff' ? (
            <div className="account-actions">
              <p>{S.profile.turnOffAsk}</p>
              <button className="btn danger-link" disabled={busy} onClick={() => void flip('profile', false)}>{S.profile.turnOffYes}</button>
              <button className="btn secondary wide" onClick={() => setAsk(null)}>{S.profile.turnOffNo}</button>
            </div>
          ) : (
            <label className="toggle">
              <input
                type="checkbox"
                checked={consents.profile}
                disabled={busy}
                onChange={(e) => (e.target.checked ? void flip('profile', true) : setAsk('turnOff'))}
              />
              <span>
                <strong>{S.profile.saveSwitch}</strong>
                <small>{S.profile.saveSwitchHint}</small>
              </span>
            </label>
          )}
          {consents.profile ? (
            <div className="profile-rows">
              {nicknameRow}
              {locationRow}
              {yearRow}
              {CHOICE_FIELDS.map(row)}
            </div>
          ) : (
            <p className="hint">{S.profile.offHint}</p>
          )}
        </section>

        <section className="card">
          <h2>{S.profile.usesTitle}</h2>
          {(['offers', 'research'] as const).map((p) => (
            <label className="toggle" key={p}>
              <input type="checkbox" checked={consents[p]} disabled={busy || !consents.profile} onChange={(e) => void flip(p, e.target.checked)} />
              <span>
                <strong>{S.profile[p]}</strong>
                <small>{consents.profile ? S.profile[p === 'offers' ? 'offersHint' : 'researchHint'] : S.profile.needsSave}</small>
              </span>
            </label>
          ))}
        </section>

        <section className="card">
          <h2>{S.profile.pricesTitle}</h2>
          <p className="hint">{S.profile.pricesText}</p>
        </section>

        {consents.profile && hasAnswers && (
          <section className="card">
            {ask === 'deleteAll' ? (
              <div className="account-actions">
                <p>{S.profile.deleteAllAsk}</p>
                <button
                  className="btn danger-link"
                  disabled={busy}
                  onClick={() => void run(async () => { await deleteAnswers(); return loadProfile(); }, (d) => { setData(d); setAsk(null); setNote(S.profile.deleted); })}
                >
                  {S.profile.deleteAllYes}
                </button>
                <button className="btn secondary wide" onClick={() => setAsk(null)}>{S.profile.cancel}</button>
              </div>
            ) : (
              <button className="btn danger-link" disabled={busy} onClick={() => setAsk('deleteAll')}>{S.profile.deleteAll}</button>
            )}
          </section>
        )}
      </div>
      {nav}
    </main>
  );
}
