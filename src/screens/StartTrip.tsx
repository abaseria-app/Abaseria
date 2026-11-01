import { useEffect, useMemo, useRef, useState } from 'react';
import { S } from '../strings';
import { branchesByRecent, branchLabel, db, getSetting, newUuid, setSetting, STORE_CHAINS, type Branch } from '../lib/db';
import { parsePesoInput } from '../lib/money';
import { logEvent } from '../lib/events';
import {
  formatDistance,
  getPosition,
  goodEnoughToSave,
  nearbySameChain,
  suggestBranches,
  type LocationStatus,
  type Position,
  type RankedBranch,
} from '../lib/location';

interface Props {
  testMode: boolean;
  onStarted: (tripId: number) => void;
  onBack: () => void;
}

/** Rows shown before "Show more" when nothing is near. */
const LIST_LIMIT = 5;

export function StartTrip({ testMode, onStarted, onBack }: Props) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  // The reading lives only in this component's state. It's never written to storage or an event.
  const [pos, setPos] = useState<Position | null>(null);
  const [loc, setLoc] = useState<LocationStatus | 'pending'>('pending');
  // What the shopper tapped. Until they tap, the selection is the location suggestion.
  const [chosen, setChosen] = useState<Branch | null>(null);
  const addedUuid = useRef<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addChain, setAddChain] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [dupe, setDupe] = useState<RankedBranch | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [budget, setBudget] = useState('');
  const [tester, setTester] = useState('');
  const [tripIndex, setTripIndex] = useState(1);
  const [prompted, setPrompted] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const list = await branchesByRecent();
      setBranches(list);
      if (list.length === 0) setAdding(true);
      setTester((await getSetting('lastTester')) ?? '');
    })();
    getPosition().then(({ pos, status }) => {
      setPos(pos);
      setLoc(status);
    });
  }, []);

  const suggestion = useMemo(() => suggestBranches(branches ?? [], pos), [branches, pos]);
  const selected = chosen ?? suggestion.preselect;

  useEffect(() => {
    const id = tester.trim().toUpperCase();
    if (!testMode || !id) {
      setTripIndex(1);
      return;
    }
    db.trips
      .where('testerId')
      .equals(id)
      .filter((t) => !t.cancelledAt)
      .count()
      .then((n) => {
        setTripIndex(n + 1);
        setPrompted(n === 0);
      });
  }, [tester, testMode]);

  function pick(b: Branch) {
    setChosen(b);
  }

  function openAdd() {
    setAdding(true);
    setAddChain(null);
    setAddName('');
    setDupe(null);
    setAddError(null);
  }

  async function saveBranch(confirmedDifferent = false) {
    const name = addName.trim();
    if (!addChain || !name || !branches) return;
    if (branches.some((b) => b.chain === addChain && b.name.toLowerCase() === name.toLowerCase())) {
      setAddError(S.start.sameName);
      return;
    }
    if (!confirmedDifferent) {
      const near = nearbySameChain(branches, addChain, pos);
      if (near) {
        setDupe(near);
        return;
      }
    }
    const pin = goodEnoughToSave(pos);
    const b: Branch = {
      uuid: newUuid(),
      chain: addChain,
      name,
      lat: pin ? pos.lat : null,
      lng: pin ? pos.lng : null,
      createdAt: new Date().toISOString(),
    };
    b.id = await db.branches.add(b);
    await logEvent('branch_added', null, { branch_uuid: b.uuid, chain: b.chain, pinned: pin, location: loc });
    addedUuid.current = b.uuid;
    setBranches([b, ...branches]);
    setChosen(b);
    setAdding(false);
    setDupe(null);
    setSavedNote(pin ? null : S.start.noCoordsSaved);
  }

  async function start() {
    if (!selected) return;
    // A branch saved without coordinates gets pinned by the first trip that has a good reading there.
    if (selected.lat == null && goodEnoughToSave(pos) && selected.id != null) {
      await db.branches.update(selected.id, { lat: pos.lat, lng: pos.lng });
    }
    const testerId = testMode && tester.trim() ? tester.trim().toUpperCase() : null;
    const budgetCentavos = budget.trim() ? parsePesoInput(budget) : null;
    const id = await db.trips.add({
      chain: selected.chain,
      customStore: selected.name,
      branchUuid: selected.uuid,
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
    if (testerId) await setSetting('lastTester', testerId);
    const branchPick =
      addedUuid.current === selected.uuid
        ? 'added'
        : suggestion.preselect
          ? suggestion.preselect.uuid === selected.uuid
            ? 'suggested'
            : 'changed'
          : 'list';
    // How the branch was picked tells us whether the location suggestion is right; the reading itself isn't logged.
    await logEvent('trip_start', id, {
      store: branchLabel(selected),
      branch_uuid: selected.uuid,
      branch_pick: branchPick,
      location: loc,
      suggestion: suggestion.reason,
      budget: budgetCentavos,
      tester_id: testerId,
      trip_index: testerId ? tripIndex : 1,
      prompted,
    });
    onStarted(id);
  }

  const status = (() => {
    if (!branches) return null;
    if (branches.length === 0) return S.start.firstStore;
    if (loc === 'pending') return S.start.locating;
    if (loc === 'denied') return S.start.locationDenied;
    if (loc === 'rough') return S.start.locationRough;
    if (loc === 'unavailable') return S.start.locationUnavailable;
    const r = suggestion.reason;
    if (r === 'near' && suggestion.preselect) {
      const m = suggestion.ranked[0].meters ?? 0;
      return S.start.nearest(branchLabel(suggestion.preselect), formatDistance(m));
    }
    if (r === 'ambiguous') return S.start.ambiguous;
    if (r === 'none-near') return S.start.noneNear;
    return null;
  })();

  const rows = suggestion.ranked;
  const limit = showAll ? rows.length : Math.max(suggestion.nearCount, LIST_LIMIT);
  const visible = rows.slice(0, limit);
  // Keep the selected branch on screen even if it sits below the cut.
  if (selected && !visible.some((r) => r.branch.uuid === selected.uuid)) {
    const r = rows.find((x) => x.branch.uuid === selected.uuid);
    if (r) visible.push(r);
  }
  const hidden = rows.length - visible.length;

  return (
    <main className="screen start">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.start.back}</button>
        <h1>{S.start.title}</h1>
        <span className="spacer" />
      </header>

      <h2>{S.start.whereLabel}</h2>
      {status && <p className={suggestion.reason === 'ambiguous' && loc === 'ok' ? 'notice' : 'hint'}>{status}</p>}
      {savedNote && <p className="hint">{savedNote}</p>}

      {!adding && (
        <>
          <ul className="branch-list">
            {visible.map(({ branch: b, meters }, i) => (
              <li key={b.uuid}>
                <button
                  className={`branch-row ${selected?.uuid === b.uuid ? 'on' : ''} ${i < suggestion.nearCount ? 'near' : ''}`}
                  aria-pressed={selected?.uuid === b.uuid}
                  onClick={() => pick(b)}
                >
                  <span>{branchLabel(b)}</span>
                  {meters != null && <small>{formatDistance(meters)}</small>}
                </button>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button className="link" onClick={() => setShowAll(true)}>{S.start.moreStores(hidden)}</button>
          )}
          <button className={`chip ghost add-store ${suggestion.reason === 'none-near' ? 'on' : ''}`} onClick={openAdd}>
            {S.start.addStore}
          </button>
        </>
      )}

      {adding && (
        <section className="add-branch card">
          <h3>{S.start.addTitle}</h3>
          <p className="label">{S.start.chainLabel}</p>
          <div className="chips stores">
            {STORE_CHAINS.map((c) => (
              <button
                key={c}
                className={`chip ${addChain === c ? 'on' : ''}`}
                onClick={() => {
                  setAddChain(c);
                  setDupe(null);
                  setAddError(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>
          {addChain && (
            <label className="field">
              <span className="label">{addChain === 'Other' ? S.start.otherNameLabel : S.start.branchLabel}</span>
              <input
                value={addName}
                onChange={(e) => {
                  setAddName(e.target.value);
                  setAddError(null);
                }}
                placeholder={addChain === 'Other' ? S.start.otherNamePlaceholder : S.start.branchPlaceholder}
                autoComplete="off"
              />
            </label>
          )}
          {addError && <p className="warn">{addError}</p>}
          {dupe && (
            <div className="warn">
              <p>{S.start.duplicate(branchLabel(dupe.branch), formatDistance(dupe.meters!))}</p>
              <div className="seg">
                <button
                  onClick={() => {
                    pick(dupe.branch);
                    setAdding(false);
                    setDupe(null);
                  }}
                >
                  {S.start.useThatOne}
                </button>
                <button onClick={() => saveBranch(true)}>{S.start.itsDifferent}</button>
              </div>
            </div>
          )}
          {!dupe && (
            <div className="row add-actions">
              {branches && branches.length > 0 && (
                <button className="btn secondary" onClick={() => setAdding(false)}>{S.start.cancelAdd}</button>
              )}
              <button className="btn primary" disabled={!addChain || !addName.trim()} onClick={() => saveBranch()}>
                {S.start.saveStore}
              </button>
            </div>
          )}
          <p className="hint small">{S.start.locationPrivacy}</p>
        </section>
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
        <button className="btn primary huge" disabled={!selected || adding} onClick={start}>
          {selected && !adding ? S.start.startButton : S.start.pickStore}
        </button>
      </div>
    </main>
  );
}
