import { useCallback, useEffect, useMemo, useState } from 'react';
import { S } from '../strings';
import { getSetting, setSetting } from '../lib/db';
import { formatPeso } from '../lib/money';
import { loadPhoneCatalog, loadSharedCatalog, mergeCatalogs } from '../lib/catalog';
import { dayOf, storesIn, type CatalogItem } from '../lib/search';
import {
  BUDGETS,
  DIETS,
  MEAL_TYPES,
  NO_RECIPE_FILTERS,
  RECIPE_CATEGORIES,
  RECIPE_SORTS,
  TIME_BANDS,
  costRecipe,
  filterRecipes,
  loadRecipeBook,
  readSaved,
  toggleSaved,
  totalMinutes,
  withSaved,
  writeSaved,
  type BookState,
  type Diet,
  type LineCost,
  type MealType,
  type Recipe,
  type RecipeBook,
  type RecipeCategory,
  type RecipeCost,
  type RecipeFilters,
  type RecipeSort,
  type SavedRecipes,
  type TimeBand,
} from '../lib/recipes';
import { Icon } from '../components/Icon';
import { MrecSlot } from '../components/AdSlot';
import { addLines, ensureCurrentList, recipeLines } from '../lib/lists';

// ---------------------------------------------------------------------------------------------------------
// Data shared by the list and the recipe screen. Loaded once per app session; the list's retry reloads it.

interface RecipeData {
  state: BookState | 'loading';
  error?: string;
  book: RecipeBook;
  saved: SavedRecipes;
  catalog: CatalogItem[];
  /** Null: any store, cheapest. */
  storeKey: string | null;
}

const EMPTY: RecipeData = { state: 'loading', book: { recipes: [], ingredients: {}, fetchedAt: '' }, saved: { slugs: [], copies: {} }, catalog: [], storeKey: null };
const STORE_KEY = 'recipeStore';
let session: RecipeData | null = null;
const listeners = new Set<(d: RecipeData) => void>();

function publish(d: RecipeData) {
  session = d;
  for (const l of listeners) l(d);
}

async function load() {
  publish({ ...(session ?? EMPTY), state: 'loading' });
  const [r, saved, phone, store] = await Promise.all([loadRecipeBook(), readSaved(), loadPhoneCatalog().catch(() => []), getSetting(STORE_KEY)]);
  const base: RecipeData = { state: r.state, error: r.error, book: withSaved(r.book, saved), saved, catalog: phone, storeKey: store || null };
  publish(base);
  // Shared prices can take a few seconds; recipes show first and costs fill in.
  const shared = await loadSharedCatalog();
  if (shared.items.length && session) publish({ ...session, catalog: mergeCatalogs(phone, shared.items) });
}

function useRecipeData(): [RecipeData, { retry: () => void; setSaved: (s: SavedRecipes) => void; setStore: (k: string | null) => void }] {
  const [data, setData] = useState<RecipeData>(session ?? EMPTY);
  useEffect(() => {
    listeners.add(setData);
    if (!session) void load();
    return () => {
      listeners.delete(setData);
    };
  }, []);
  const actions = useMemo(
    () => ({
      retry: () => void load(),
      setSaved: (saved: SavedRecipes) => {
        void writeSaved(saved);
        if (session) publish({ ...session, saved, book: withSaved(session.book, saved) });
      },
      setStore: (k: string | null) => {
        void setSetting(STORE_KEY, k ?? '');
        if (session) publish({ ...session, storeKey: k });
      },
    }),
    [],
  );
  return [data, actions];
}

const today = () => dayOf(new Date());
const dayFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });
const shortDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00`));

// ---------------------------------------------------------------------------------------------------------
// List (the Recipes tab on Explore)

export function RecipesPanel({ onOpen }: { onOpen: (slug: string) => void }) {
  const [data, { retry, setSaved }] = useRecipeData();
  const [filters, setFilters] = useState<RecipeFilters>(NO_RECIPE_FILTERS);
  const [sort, setSort] = useState<RecipeSort>('newest');
  const savedSet = useMemo(() => new Set(data.saved.slugs), [data.saved]);

  const costs = useMemo(() => {
    const m = new Map<string, RecipeCost>();
    const t = today();
    for (const r of data.book.recipes) m.set(r.slug, costRecipe(r, data.book.ingredients, data.catalog, { storeKey: data.storeKey, servings: r.servings, toggled: new Set(), today: t }));
    return m;
  }, [data.book, data.catalog, data.storeKey]);
  const buyCosts = useMemo(() => new Map([...costs].filter(([, c]) => c.show).map(([k, c]) => [k, c.buyCentavos])), [costs]);
  const list = useMemo(() => filterRecipes(data.book.recipes, filters, sort, buyCosts, savedSet), [data.book, filters, sort, buyCosts, savedSet]);
  const set = <K extends keyof RecipeFilters>(k: K, v: RecipeFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const loading = data.state === 'loading' && !data.book.recipes.length;
  return (
    <section className="recipes" aria-label={S.explore.tabs.recipes}>
      <div className="search-box recipe-search">
        <input type="search" enterKeyHint="search" autoComplete="off" placeholder={S.recipes.search} aria-label={S.recipes.search} value={filters.text} onChange={(e) => set('text', e.target.value)} />
        {filters.text && (
          <button className="search-clear" aria-label={S.recipes.clear} onClick={() => set('text', '')}>
            <Icon name="close" size={20} />
          </button>
        )}
      </div>

      <div className="recipe-cats" role="group" aria-label={S.recipes.categories.all}>
        {[null, ...RECIPE_CATEGORIES].map((c) => (
          <button key={c ?? 'all'} className={`chip cat ${filters.category === c ? 'on' : ''}`} aria-pressed={filters.category === c} onClick={() => set('category', c as RecipeCategory | null)}>
            {S.recipes.categories[c ?? 'all']}
          </button>
        ))}
      </div>

      <div className="recipe-filters">
        <Select label={S.recipes.meal} value={filters.meal ?? ''} onChange={(v) => set('meal', (v || null) as MealType | null)} options={[['', S.recipes.anyMeal], ...MEAL_TYPES.map((m) => [m, S.recipes.meals[m]] as [string, string])]} />
        <Select label={S.recipes.diet} value={filters.diet ?? ''} onChange={(v) => set('diet', (v || null) as Diet | null)} options={[['', S.recipes.anyDiet], ...DIETS.map((d) => [d, S.recipes.diets[d]] as [string, string])]} />
        <Select label={S.recipes.time} value={filters.time} onChange={(v) => set('time', v as TimeBand)} options={(Object.keys(TIME_BANDS) as TimeBand[]).map((t) => [t, S.recipes.times[t]])} />
        <Select
          label={S.recipes.budgetLabel}
          value={filters.budget == null ? '' : String(filters.budget)}
          onChange={(v) => set('budget', v ? Number(v) : null)}
          options={[['', S.recipes.anyBudget], ...BUDGETS.map((b) => [String(b), S.recipes.budget(formatPeso(b).replace('.00', ''))] as [string, string])]}
        />
        <Select label={S.recipes.sort} value={sort} onChange={(v) => setSort(v as RecipeSort)} options={RECIPE_SORTS.map((s) => [s, S.recipes.sorts[s]])} />
        <button className={`chip ${filters.savedOnly ? 'on' : ''}`} aria-pressed={filters.savedOnly} onClick={() => set('savedOnly', !filters.savedOnly)}>
          <Icon name="heart" size={18} /> {S.recipes.savedOnly}
        </button>
      </div>

      <Status data={data} onRetry={retry} />

      {loading ? (
        <p className="hint center">{S.recipes.loading}</p>
      ) : !data.book.recipes.length ? (
        data.state === 'ok' && <p className="hint center">{S.recipes.none}</p>
      ) : !list.length ? (
        <p className="hint center">{S.recipes.empty}</p>
      ) : (
        <>
          <p className="label">{S.recipes.count(list.length)}</p>
          <ul className="recipe-list">
            {list.map((r, i) => (
              <li key={r.slug}>
                <RecipeCard
                  recipe={r}
                  cost={costs.get(r.slug)}
                  saved={savedSet.has(r.slug)}
                  onOpen={() => onOpen(r.slug)}
                  onSave={() => setSaved(toggleSaved(data.saved, r, data.book.ingredients))}
                />
                {i === 5 && <MrecSlot />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Status({ data, onRetry }: { data: RecipeData; onRetry: () => void }) {
  let text: string | null = null;
  if (data.state === 'offline') text = S.recipes.offline;
  else if (data.state === 'cached') text = navigator.onLine === false ? S.recipes.offline : S.recipes.cachedNote(data.error ?? '');
  else if (data.state === 'error') text = S.recipes.failed(data.error ?? '');
  if (!text) return null;
  return (
    <p className="hint">
      {text}{' '}
      <button className="link inline" onClick={onRetry}>
        {S.recipes.retry}
      </button>
    </p>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="recipe-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecipeImage({ recipe, thumb, className }: { recipe: Recipe; thumb?: boolean; className: string }) {
  const [src, setSrc] = useState(thumb ? (recipe.thumb ?? recipe.image) : recipe.image);
  if (!src)
    return (
      <span className={`${className} blank`} aria-hidden="true">
        <Icon name="recipes" size={thumb ? 30 : 44} stroke={1.6} />
      </span>
    );
  // A missing -thumb file falls back to the full picture, then to the blank tile.
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setSrc(src === recipe.image || !recipe.image ? null : recipe.image)} />;
}

function CostLine({ cost }: { cost: RecipeCost | undefined }) {
  if (!cost?.show) return <small className="recipe-cost soon">{S.recipes.priceSoon}</small>;
  return (
    <small className="recipe-cost">
      <strong>{formatPeso(cost.cookCentavos)}</strong> {S.recipes.toCook} · <strong>{formatPeso(cost.buyCentavos)}</strong> {S.recipes.toBuy}
    </small>
  );
}

function RecipeCard({ recipe, cost, saved, onOpen, onSave }: { recipe: Recipe; cost: RecipeCost | undefined; saved: boolean; onOpen: () => void; onSave: () => void }) {
  return (
    <article className="recipe-card">
      <button className="recipe-card-main" onClick={onOpen}>
        <RecipeImage recipe={recipe} thumb className="recipe-thumb" />
        <span className="recipe-card-text">
          <strong>{recipe.titleEn}</strong>
          {recipe.titleTl && <small className="recipe-tl">{recipe.titleTl}</small>}
          <small>
            {S.recipes.minutes(totalMinutes(recipe))} · {S.recipes.serves(recipe.servings)}
          </small>
          <CostLine cost={cost} />
          {recipe.sponsor && <small className="promo-tag">{S.recipes.sponsoredBy(recipe.sponsor)}</small>}
        </span>
      </button>
      <SaveButton saved={saved} onClick={onSave} />
    </article>
  );
}

function SaveButton({ saved, onClick }: { saved: boolean; onClick: () => void }) {
  return (
    <button className={`recipe-save ${saved ? 'on' : ''}`} aria-pressed={saved} aria-label={saved ? S.recipes.unsave : S.recipes.save} onClick={onClick}>
      <Icon name="heart" size={24} />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------
// One recipe

type DetailTab = 'ingredients' | 'steps' | 'nutrition';

export function RecipeDetail({ slug, onBack, onOpenList }: { slug: string; onBack: () => void; onOpenList: () => void }) {
  const [data, { setSaved, setStore }] = useRecipeData();
  const recipe = data.book.recipes.find((r) => r.slug === slug) ?? null;
  const [servings, setServings] = useState<number | null>(null);
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set());
  const [tab, setTab] = useState<DetailTab>('ingredients');
  const [toast, setToast] = useState<string | null>(null);
  const [listNote, setListNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const stores = useMemo(() => storesIn(data.catalog), [data.catalog]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const serves = servings ?? recipe?.servings ?? 1;
  const cost = useMemo(
    () => (recipe ? costRecipe(recipe, data.book.ingredients, data.catalog, { storeKey: data.storeKey, servings: serves, toggled, today: today() }) : null),
    [recipe, data.book.ingredients, data.catalog, data.storeKey, serves, toggled],
  );
  const toggle = useCallback((pos: number) => {
    setToggled((t) => {
      const n = new Set(t);
      if (n.has(pos)) n.delete(pos);
      else n.add(pos);
      return n;
    });
  }, []);

  if (!recipe || !cost) {
    return (
      <main className="screen recipe-detail">
        <header className="topbar">
          <button className="link" onClick={onBack}>
            {S.recipes.back}
          </button>
          <span className="spacer" />
        </header>
        <p className="hint center">{data.state === 'loading' ? S.recipes.loading : S.recipes.notFound}</p>
      </main>
    );
  }

  const saved = data.saved.slugs.includes(recipe.slug);
  const counted = cost.lines.filter((l) => l.status !== 'toTaste' && !l.line.optional && !(l.status === 'noPrice' && l.ingredient?.isPantryStaple));
  const pricedCount = counted.filter((l) => l.status === 'priced').length;

  return (
    <main className="screen recipe-detail">
      <header className="topbar">
        <button className="link" onClick={onBack}>
          {S.recipes.back}
        </button>
        <span className="spacer" />
        <SaveButton
          saved={saved}
          onClick={() => {
            setSaved(toggleSaved(data.saved, recipe, data.book.ingredients));
            setToast(saved ? S.recipes.unsaved : S.recipes.saved);
          }}
        />
      </header>
      {toast && <p className="toast">{toast}</p>}

      <Media recipe={recipe} />

      <h1 className="recipe-title">{recipe.titleEn}</h1>
      {recipe.titleTl && <p className="recipe-tl">{recipe.titleTl}</p>}
      {recipe.sponsor && <p className="promo-tag">{S.recipes.sponsoredBy(recipe.sponsor)}</p>}
      {recipe.summaryEn && <p className="recipe-summary">{recipe.summaryEn}</p>}

      <dl className="recipe-times">
        <div>
          <dt>{S.recipes.prep}</dt>
          <dd>{S.recipes.minutes(recipe.prepMin)}</dd>
        </div>
        <div>
          <dt>{S.recipes.cook}</dt>
          <dd>{S.recipes.minutes(recipe.cookMin)}</dd>
        </div>
        <div>
          <dt>{S.recipes.total}</dt>
          <dd>{S.recipes.minutes(totalMinutes(recipe))}</dd>
        </div>
      </dl>

      <div className="recipe-controls">
        <div className="recipe-stepper" role="group" aria-label={S.recipes.servings}>
          <span className="label">{S.recipes.servings}</span>
          <button className="chip" aria-label={S.recipes.fewer} disabled={serves <= 1} onClick={() => setServings(Math.max(1, serves - 1))}>
            −
          </button>
          <strong aria-live="polite">{serves}</strong>
          <button className="chip" aria-label={S.recipes.more} disabled={serves >= 50} onClick={() => setServings(Math.min(50, serves + 1))}>
            +
          </button>
        </div>
        <label className="recipe-select store">
          <span className="label">{S.recipes.store}</span>
          <select value={data.storeKey ?? ''} onChange={(e) => setStore(e.target.value || null)}>
            <option value="">{S.recipes.anyStore}</option>
            {stores.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className={`recipe-costs ${cost.show ? '' : 'soon'}`} aria-live="polite">
        {cost.show ? (
          <>
            <div>
              <span className="label">{S.recipes.costToCook}</span>
              <strong>{formatPeso(cost.cookCentavos)}</strong>
              <small>{S.recipes.costToCookHint}</small>
            </div>
            <div>
              <span className="label">{S.recipes.costToBuy}</span>
              <strong>{formatPeso(cost.buyCentavos)}</strong>
              <small>{S.recipes.costToBuyHint}</small>
            </div>
            {cost.usesOtherStores && <p className="hint">{S.recipes.otherStores}</p>}
          </>
        ) : (
          <div>
            <span className="label">{S.recipes.priceSoon}</span>
            <small>{S.recipes.priceSoonBody}</small>
          </div>
        )}
        <p className="hint">{S.recipes.coverage(pricedCount, counted.length)}</p>
      </section>

      <section className="recipe-to-list">
        <button
          className="btn primary wide"
          disabled={adding}
          onClick={async () => {
            const lines = recipeLines(recipe, cost.lines, serves);
            if (!lines.length) return setListNote(S.lists.fromRecipeNone);
            setAdding(true);
            try {
              const list = await ensureCurrentList();
              const r = await addLines(list.id!, lines);
              setListNote(S.lists.fromRecipeDone(r.added, r.merged, list.name));
            } finally {
              setAdding(false);
            }
          }}
        >
          {S.lists.fromRecipe}
        </button>
        {listNote ? (
          <p className="hint">
            {listNote}{' '}
            <button className="link" onClick={onOpenList}>
              {S.lists.openList}
            </button>
          </p>
        ) : (
          <p className="hint">{S.lists.fromRecipeHint}</p>
        )}
      </section>

      <nav className="recipe-tabs" role="tablist">
        {(['ingredients', 'steps', 'nutrition'] as DetailTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {S.recipes.tabs[t]}
          </button>
        ))}
      </nav>

      {tab === 'ingredients' && <Ingredients lines={cost.lines} onToggle={toggle} />}
      {tab === 'steps' && <Steps recipe={recipe} />}
      {tab === 'nutrition' && <NutritionFacts recipe={recipe} />}
    </main>
  );
}

/** The picture, and the video only once tapped: nothing loads from YouTube until then (prepaid data). */
function Media({ recipe }: { recipe: Recipe }) {
  const [playing, setPlaying] = useState(false);
  if (recipe.youtubeId && playing) {
    return (
      <div className="recipe-media video">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${recipe.youtubeId}?autoplay=1&rel=0`}
          title={S.recipes.videoTitle(recipe.titleEn)}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <div className="recipe-media">
      <RecipeImage recipe={recipe} className="recipe-hero" />
      {recipe.youtubeId && (
        <button className="recipe-play" onClick={() => setPlaying(true)}>
          <Icon name="play" size={28} />
          <span>
            {S.recipes.video}
            <small>{S.recipes.videoNote}</small>
          </span>
        </button>
      )}
    </div>
  );
}

function Ingredients({ lines, onToggle }: { lines: LineCost[]; onToggle: (pos: number) => void }) {
  const groups: Array<{ name: string | null; lines: LineCost[] }> = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (last && last.name === l.line.group) last.lines.push(l);
    else groups.push({ name: l.line.group, lines: [l] });
  }
  return (
    <div className="recipe-ingredients">
      <p className="label ing-head">{S.recipes.have}</p>
      {groups.map((g, gi) => (
        <section key={gi}>
          {g.name && <h3>{g.name}</h3>}
          <ul>
            {g.lines.map((l) => (
              <li key={l.line.position} className={l.have ? 'have' : ''}>
                {l.status === 'toTaste' ? (
                  <span className="ing-check blank" aria-hidden="true" />
                ) : (
                  <input type="checkbox" className="ing-check" checked={l.have} aria-label={S.recipes.haveAria(l.text)} onChange={() => onToggle(l.line.position)} />
                )}
                <span className="ing-text">
                  <span>
                    {l.text}
                    {l.line.optional && <em> ({S.recipes.optional})</em>}
                  </span>
                  <IngredientPrice l={l} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function IngredientPrice({ l }: { l: LineCost }) {
  if (l.status === 'toTaste') return <small>{S.recipes.toTaste}</small>;
  if (l.status === 'unmatched') return <small className="muted">{S.recipes.unmatched}</small>;
  if (l.status === 'noPrice' || !l.chosen) return <small className="muted">{S.recipes.noPrice}</small>;
  const c = l.chosen;
  const shelf = c.perKg ? S.recipes.perKg(formatPeso(c.shelfCentavos)) : formatPeso(c.shelfCentavos);
  const name = c.size && !c.productName.includes(c.size) ? `${c.productName} ${c.size}` : c.productName;
  return (
    <>
      <small>
        {S.recipes.priceLine(name, shelf, c.storeLabel, shortDay(c.seenOn))}
        {!c.perKg && ` · ${S.recipes.packs(c.packs)}`}
        {c.sponsored && <span className="promo-tag"> {S.recipes.sponsored}</span>}
      </small>
      {l.cheaper && <small className="ing-cheaper">{S.recipes.cheaper(l.cheaper.productName, formatPeso(l.cheaper.buyCentavos))}</small>}
    </>
  );
}

function Steps({ recipe }: { recipe: Recipe }) {
  if (!recipe.steps.length) return <p className="hint">{S.recipes.noSteps}</p>;
  return (
    <div className="recipe-steps">
      <ol>
        {recipe.steps.map((s, i) => (
          <li key={i}>
            <span className="label">{S.recipes.step(i + 1)}</span>
            <p>{s.en}</p>
          </li>
        ))}
      </ol>
      {recipe.tipsEn && (
        <section>
          <h3>{S.recipes.tips}</h3>
          <p>{recipe.tipsEn}</p>
        </section>
      )}
    </div>
  );
}

function NutritionFacts({ recipe }: { recipe: Recipe }) {
  const n = recipe.nutrition;
  const rows = n ? Object.entries(n).filter(([k, v]) => S.recipes.nutrients[k] && typeof v === 'number') : [];
  if (!rows.length) return <p className="hint">{S.recipes.nutritionNone}</p>;
  return (
    <div className="recipe-nutrition">
      <p className="label">{S.recipes.nutritionPer}</p>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{S.recipes.nutrients[k]}</th>
              <td>
                {v} {S.recipes.units[k]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{recipe.nutritionSource === 'fnri' ? S.recipes.nutritionFnri : S.recipes.nutritionEstimated}</p>
    </div>
  );
}
