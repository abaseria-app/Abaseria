import { useEffect, useState } from 'react';
import { S } from '../strings';
import { db, getSetting, setSetting, STORE_CHAINS } from '../lib/db';
import { parsePesoInput } from '../lib/money';
import { logEvent } from '../lib/events';

interface Props {
  testMode: boolean;
  onStarted: (tripId: number) => void;
  onBack: () => void;
}

export function StartTrip({ testMode, onStarted, onBack }: Props) {
  const [chains, setChains] = useState<string[]>([...STORE_CHAINS]);
  const [chain, setChain] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [budget, setBudget] = useState('');
  const [tester, setTester] = useState('');
  const [tripIndex, setTripIndex] = useState(1);
  const [prompted, setPrompted] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const last = await getSetting('lastChain');
      if (last && STORE_CHAINS.includes(last as never)) {
        setChains([last, ...STORE_CHAINS.filter((c) => c !== last)]);
        setChain(last);
      }
      setTester((await getSetting('lastTester')) ?? '');
    })();
  }, []);

  useEffect(() => {
    const id = tester.trim().toUpperCase();
    if (!testMode || !id) {
      setTripIndex(1);
      return;
    }
    db.trips
      .where('testerId')
      .equals(id)
      .count()
      .then((n) => {
        setTripIndex(n + 1);
        setPrompted(n === 0);
      });
  }, [tester, testMode]);

  async function start() {
    if (!chain) return;
    const testerId = testMode && tester.trim() ? tester.trim().toUpperCase() : null;
    const budgetCentavos = budget.trim() ? parsePesoInput(budget) : null;
    const id = await db.trips.add({
      chain,
      customStore: chain === 'Other' ? custom.trim() || null : null,
      budgetCentavos,
      testerId,
      tripIndex: testerId ? tripIndex : 1,
      prompted: testMode ? prompted : false,
      startedAt: new Date().toISOString(),
      endedAt: null,
      receiptMatched: null,
      receiptTotalCentavos: null,
      receiptItemCount: null,
    });
    await setSetting('lastChain', chain);
    if (testerId) await setSetting('lastTester', testerId);
    await logEvent('trip_start', id, { store: chain, custom_store: custom || null, budget: budgetCentavos, tester_id: testerId, trip_index: testerId ? tripIndex : 1, prompted });
    onStarted(id);
  }

  return (
    <main className="screen start">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.start.back}</button>
        <h1>{S.start.title}</h1>
        <span className="spacer" />
      </header>

      <h2>{S.start.whereLabel}</h2>
      <div className="chips stores">
        {chains.map((c) => (
          <button key={c} className={`chip ${chain === c ? 'on' : ''}`} onClick={() => setChain(c)}>{c}</button>
        ))}
      </div>
      {chain === 'Other' && (
        <label className="field">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={S.start.otherPlaceholder} />
        </label>
      )}

      <label className="field">
        <span className="label">{S.start.budgetLabel}</span>
        <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={S.start.budgetPlaceholder} />
      </label>

      {testMode && (
        <section className="test-box">
          <label className="field">
            <span className="label">{S.start.testerLabel}</span>
            <input value={tester} onChange={(e) => setTester(e.target.value)} placeholder={S.start.testerPlaceholder} autoCapitalize="characters" />
          </label>
          {tester.trim() && <p className="hint">{S.start.tripNumber(tripIndex)}</p>}
          <p className="label">{S.start.promptedLabel}</p>
          <div className="seg">
            <button className={prompted ? 'on' : ''} onClick={() => setPrompted(true)}>{S.start.yes}</button>
            <button className={!prompted ? 'on' : ''} onClick={() => setPrompted(false)}>{S.start.no}</button>
          </div>
        </section>
      )}

      <div className="bottom">
        <button className="btn primary huge" disabled={!chain} onClick={start}>
          {chain ? S.start.startButton : S.start.pickStore}
        </button>
      </div>
    </main>
  );
}
