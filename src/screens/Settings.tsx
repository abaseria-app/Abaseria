import { useEffect, useState } from 'react';
import { S } from '../strings';
import { exportCsvFiles } from '../lib/export';
import { checkConnection, dbConfig, type DbStatus } from '../lib/supabase';
import { SHARING_ON, sharePending, waitingToShare, type ShareResult } from '../lib/sync';
import { signOut, type Account } from '../lib/auth';

interface Props {
  account: Account | null;
  testMode: boolean;
  onTestMode: (on: boolean) => void;
  onOcrCheck: () => void;
  onResults: () => void;
  onBack: () => void;
}

export function Settings({ account, testMode, onTestMode, onOcrCheck, onResults, onBack }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [db, setDb] = useState<DbStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [share, setShare] = useState<ShareResult | null>(null);
  const [sharing, setSharing] = useState(false);
  const [askSignOut, setAskSignOut] = useState(false);
  useEffect(() => {
    waitingToShare().then(setWaiting);
  }, [share]);
  return (
    <main className="screen settings">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.settings.back}</button>
        <h1>{S.settings.title}</h1>
        <span className="spacer" />
      </header>

      {account && (
        <section className="card">
          <h2>{S.settings.account}</h2>
          <p className="hint">{S.settings.signedInAs(account.name, account.email)}</p>
          {askSignOut ? (
            <div className="account-actions">
              <p>{S.settings.signOutAsk}</p>
              <button className="btn danger-link" onClick={() => signOut()}>{S.settings.signOutYes}</button>
              <button className="btn secondary wide" onClick={() => setAskSignOut(false)}>{S.settings.signOutNo}</button>
            </div>
          ) : (
            <button className="btn secondary wide" onClick={() => setAskSignOut(true)}>{S.settings.signOut}</button>
          )}
        </section>
      )}

      <label className="toggle card">
        <input type="checkbox" checked={testMode} onChange={(e) => onTestMode(e.target.checked)} />
        <span>
          <strong>{S.settings.testMode}</strong>
          <small>{S.settings.testModeHint}</small>
        </span>
      </label>

      <button className="btn secondary wide" onClick={async () => { await exportCsvFiles(); setMsg(S.settings.exported); }}>
        {S.settings.export}
      </button>
      {msg && <p className="hint">{msg}</p>}

      <button className="btn secondary wide" onClick={onOcrCheck}>{S.settings.ocrCheck}</button>
      <p className="hint">{S.settings.ocrCheckHint}</p>

      <button className="btn secondary wide" onClick={onResults}>{S.settings.results}</button>
      <p className="hint">{S.settings.resultsHint}</p>

      <section className="card">
        <h2>{S.settings.db}</h2>
        {dbConfig ? (
          <>
            <button className="btn secondary wide" disabled={checking} onClick={async () => {
              setChecking(true);
              setDb(await checkConnection());
              setChecking(false);
            }}>
              {checking ? S.settings.dbChecking : S.settings.dbCheck}
            </button>
            {db?.state === 'ok' && <p className="hint">{S.settings.dbOk(db.target, db.branches, db.products, db.prices)}</p>}
            {db?.state === 'error' && <p className="hint">{S.settings.dbError(db.target, db.message)}</p>}
            {SHARING_ON ? (
              <>
                <p className="hint">{waiting ? S.settings.shareWaiting(waiting) : S.settings.shareNone}</p>
                {!!waiting && (
                  <button className="btn secondary wide" disabled={sharing} onClick={async () => {
                    setSharing(true);
                    setShare(await sharePending());
                    setSharing(false);
                  }}>
                    {sharing ? S.settings.sharing : S.settings.shareNow}
                  </button>
                )}
                {share && <p className="hint">{share.error ? S.settings.shareFailed(share.error) : S.settings.shareDone(share.trips, share.prices)}</p>}
              </>
            ) : (
              <p className="hint">{S.settings.shareOff}</p>
            )}
          </>
        ) : (
          <p className="hint">{S.settings.dbOff}</p>
        )}
      </section>

      <section className="about">
        <h2>{S.settings.about}</h2>
        <p>{SHARING_ON ? S.settings.aboutTextSharing : S.settings.aboutText}</p>
        <p className="hint">{S.settings.version}</p>
      </section>
    </main>
  );
}
