import { useState } from 'react';
import { S } from '../strings';
import { exportCsvFiles } from '../lib/export';
import { checkConnection, dbConfig, type DbStatus } from '../lib/supabase';

interface Props {
  testMode: boolean;
  onTestMode: (on: boolean) => void;
  onOcrCheck: () => void;
  onResults: () => void;
  onBack: () => void;
}

export function Settings({ testMode, onTestMode, onOcrCheck, onResults, onBack }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [db, setDb] = useState<DbStatus | null>(null);
  const [checking, setChecking] = useState(false);
  return (
    <main className="screen settings">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.settings.back}</button>
        <h1>{S.settings.title}</h1>
        <span className="spacer" />
      </header>

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
          </>
        ) : (
          <p className="hint">{S.settings.dbOff}</p>
        )}
      </section>

      <section className="about">
        <h2>{S.settings.about}</h2>
        <p>{S.settings.aboutText}</p>
        <p className="hint">{S.settings.version}</p>
      </section>
    </main>
  );
}
