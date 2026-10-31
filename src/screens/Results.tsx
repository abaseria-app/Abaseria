import { useState } from 'react';
import { S } from '../strings';
import { computeResults, parseCsv, PASS_LINE, type TestResults } from '../lib/export';

/** Pools the trips CSV from every tester's phone and checks it against the pass line. */
export function Results({ onBack }: { onBack: () => void }) {
  const [res, setRes] = useState<TestResults | null>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const rows = (await Promise.all([...files].map((f) => f.text()))).flatMap(parseCsv).filter((r) => 'trip_index' in r);
    // The same trip can arrive twice if a tester exported more than once.
    const unique = new Map(rows.map((r) => [`${r.tester_id}|${r.started_at}`, r]));
    setRes(computeResults([...unique.values()]));
  }

  return (
    <main className="screen results">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.settings.back}</button>
        <h1>{S.results.title}</h1>
        <span className="spacer" />
      </header>
      <p className="hint">{S.results.passLine(PASS_LINE.minBasket, PASS_LINE.minCoveragePct, PASS_LINE.testersNeeded)}</p>
      <label className="btn primary wide">
        {S.results.pick}
        <input type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => pick(e.target.files)} />
      </label>

      {res && (
        <>
          <div className={`score ${res.pass ? 'pass' : 'fail'}`}>
            <strong>{res.pass ? S.results.pass : S.results.fail}</strong>
            <span>{S.results.summary(res.passedCoverage, res.bigBasketTesters)}</span>
            <span>{S.results.repeat(res.secondTripUnprompted, res.testers)}</span>
            {res.medianSecPerTagItem !== '' && <span>{S.results.medianSec(res.medianSecPerTagItem)}</span>}
          </div>
          <table>
            <thead>
              <tr>{S.results.cols.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {res.perTester.map((p) => (
                <tr key={p.tester}>
                  <td>{p.tester}</td>
                  <td>{p.basket}</td>
                  <td>{p.firstTripCoverage === '' ? '' : `${p.firstTripCoverage}%`}</td>
                  <td>{p.trips}</td>
                  <td>{p.unpromptedRepeat ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
