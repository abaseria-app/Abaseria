// The shopping list screen (plan steps L2 and L9). Lists stay on this phone. Lines are grouped by category in
// aisle order; ticked lines drop to "In the basket". Adding: type it, search products, or from a recipe.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { S } from '../strings';
import { db } from '../lib/db';
import { CATEGORY_BY_ID } from '../lib/categories';
import {
  addLines, allLists, catalogLine, clearTicked, createList, deleteList, formatGrams, MAX_NAME, MAX_QUANTITY, removeLine, renameList,
  setCurrent, sortLines, toggleLine, updateLine, type ListItem,
} from '../lib/lists';
import type { CatalogItem } from '../lib/search';
import { Search } from './Search';

type Mode = 'view' | 'new' | 'rename' | 'delete' | 'search';

export function ShoppingListScreen({ onBack }: { onBack: () => void }) {
  const lists = useLiveQuery(allLists, []);
  const [viewId, setViewId] = useState<number | null>(null);
  const list = lists?.find((l) => l.id === viewId) ?? lists?.find((l) => l.isCurrent) ?? lists?.[0] ?? null;
  const lines = useLiveQuery(async () => (list ? sortLines(await db.listItems.where('listId').equals(list.id!).toArray()) : []), [list?.id]);
  const [mode, setMode] = useState<Mode>('view');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!lists) return <main className="screen shopping-list" />;

  async function make() {
    const l = await createList(name, true);
    setViewId(l.id!);
    setName('');
    setMode('view');
  }

  async function addTyped() {
    if (!text.trim()) return;
    const target = list ?? (await createList(S.lists.title, true));
    await addLines(target.id!, [{ label: text, source: 'typed' }]);
    setText('');
  }

  async function addPicked(item: CatalogItem) {
    const target = list ?? (await createList(S.lists.title, true));
    await addLines(target.id!, [catalogLine(item)]);
    setMode('view');
    setToast(S.lists.added(target.name));
  }

  if (mode === 'search') {
    return (
      <Search
        onBack={() => setMode('view')}
        pick={{
          storeKey: null,
          onPick: (item) => void addPicked(item),
          onType: (t) => {
            setText(t);
            setMode('view');
          },
        }}
      />
    );
  }

  const open = (lines ?? []).filter((l) => !l.checkedAt);
  const ticked = (lines ?? []).filter((l) => l.checkedAt);
  const groups: Array<{ category: ListItem['category']; lines: ListItem[] }> = [];
  for (const l of open) {
    const last = groups[groups.length - 1];
    if (last && last.category === l.category) last.lines.push(l);
    else groups.push({ category: l.category, lines: [l] });
  }

  return (
    <main className="screen shopping-list">
      <header className="topbar">
        <button className="link" onClick={onBack}>
          {S.lists.back}
        </button>
        <h1>{list?.name ?? S.lists.title}</h1>
        <span className="spacer" />
      </header>
      {toast && <p className="toast">{toast}</p>}

      {lists.length > 1 && (
        <label className="recipe-select list-pick">
          <span className="label">{S.lists.which}</span>
          <select value={list?.id ?? ''} onChange={(e) => setViewId(Number(e.target.value))}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.isCurrent ? S.lists.currentTag(l.name) : l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {list && !list.isCurrent && (
        <button className="btn secondary wide" onClick={() => void setCurrent(list.id!)}>
          {S.lists.makeCurrent}
        </button>
      )}
      {list?.isCurrent && lists.length > 1 && <p className="hint">{S.lists.isCurrent}</p>}

      {mode === 'new' || mode === 'rename' ? (
        <form
          className="card list-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'new') void make();
            else if (list) void renameList(list.id!, name).then(() => setMode('view'));
          }}
        >
          <label className="field">
            <span className="label">{mode === 'new' ? S.lists.newName : S.lists.renameLabel}</span>
            <input value={name} maxLength={MAX_NAME} placeholder={S.lists.newPlaceholder} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="seg">
            <button type="button" onClick={() => setMode('view')}>
              {S.lists.cancel}
            </button>
            <button type="submit" className="on" disabled={mode === 'rename' && !name.trim()}>
              {mode === 'new' ? S.lists.create : S.lists.save}
            </button>
          </div>
        </form>
      ) : mode === 'delete' && list ? (
        <div className="card account-actions">
          <p>{S.lists.deleteAsk(list.name)}</p>
          <button
            className="btn danger-link"
            onClick={async () => {
              await deleteList(list.id!);
              setViewId(null);
              setMode('view');
            }}
          >
            {S.lists.deleteYes}
          </button>
          <button className="btn secondary wide" onClick={() => setMode('view')}>
            {S.lists.cancel}
          </button>
        </div>
      ) : (
        <form
          className="list-add"
          onSubmit={(e) => {
            e.preventDefault();
            void addTyped();
          }}
        >
          <label className="field">
            <span className="label">{S.lists.addLabel}</span>
            <span className="row">
              <input value={text} maxLength={80} placeholder={S.lists.addPlaceholder} onChange={(e) => setText(e.target.value)} />
              <button type="submit" className="btn primary" disabled={!text.trim()}>
                {S.lists.add}
              </button>
            </span>
          </label>
          <button type="button" className="btn secondary wide list-search" onClick={() => setMode('search')}>
            {S.lists.searchProducts}
          </button>
        </form>
      )}

      {!open.length && !ticked.length ? (
        <p className="hint list-empty">{S.lists.empty}</p>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.category} className="list-group">
              <h2 className="label">{CATEGORY_BY_ID[g.category]?.label ?? g.category}</h2>
              <ul className="list-lines">
                {g.lines.map((l) => (
                  <Line key={l.id} line={l} />
                ))}
              </ul>
            </section>
          ))}
          {!!ticked.length && (
            <section className="list-group done">
              <h2 className="label">{S.lists.ticked(ticked.length)}</h2>
              <ul className="list-lines">
                {ticked.map((l) => (
                  <Line key={l.id} line={l} />
                ))}
              </ul>
              <button
                className="btn secondary wide"
                onClick={async () => {
                  const n = await clearTicked(list!.id!);
                  setToast(S.lists.cleared(n));
                }}
              >
                {S.lists.clearTicked}
              </button>
            </section>
          )}
        </>
      )}

      {mode === 'view' && (
        <div className="list-manage">
          <button
            className="chip"
            onClick={() => {
              setName('');
              setMode('new');
            }}
          >
            {S.lists.newList}
          </button>
          {list && (
            <>
              <button
                className="chip"
                onClick={() => {
                  setName(list.name);
                  setMode('rename');
                }}
              >
                {S.lists.rename}
              </button>
              <button className="chip" onClick={() => setMode('delete')}>
                {S.lists.deleteList}
              </button>
            </>
          )}
        </div>
      )}
      <p className="hint small">{S.lists.onPhone}</p>
    </main>
  );
}

function Line({ line }: { line: ListItem }) {
  const done = !!line.checkedAt;
  const must = line.priority === 'must';
  return (
    <li className={`list-line ${done ? 'done' : ''} ${must ? '' : 'extra'}`}>
      <input type="checkbox" className="ing-check" checked={done} aria-label={S.lists.tickAria(line.label)} onChange={() => void toggleLine(line.id!)} />
      <span className="list-text">
        <span className="list-label">{line.label}</span>
        {line.note && <small>{line.note}</small>}
        {!done && (
          <span className="list-controls">
            {line.weightGrams != null ? (
              <strong className="list-qty">{formatGrams(line.weightGrams)}</strong>
            ) : (
              <span className="recipe-stepper" role="group">
                <button className="chip" aria-label={S.lists.fewer} disabled={line.quantity <= 1} onClick={() => void updateLine(line.id!, { quantity: line.quantity - 1 })}>
                  −
                </button>
                <strong aria-live="polite">{line.quantity}</strong>
                <button className="chip" aria-label={S.lists.more} disabled={line.quantity >= MAX_QUANTITY} onClick={() => void updateLine(line.id!, { quantity: line.quantity + 1 })}>
                  +
                </button>
              </span>
            )}
            <button
              className={`chip list-priority ${must ? 'on' : ''}`}
              aria-label={S.lists.priorityAria(line.label, must)}
              onClick={() => void updateLine(line.id!, { priority: must ? 'extra' : 'must' })}
            >
              {must ? S.lists.must : S.lists.extra}
            </button>
          </span>
        )}
      </span>
      <button className="link list-remove" aria-label={S.lists.removeAria(line.label)} onClick={() => void removeLine(line.id!)}>
        ×
      </button>
    </li>
  );
}
