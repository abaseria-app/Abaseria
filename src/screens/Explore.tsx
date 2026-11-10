import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';
import { CATEGORIES, type CategoryId } from '../lib/categories';
import { getSetting, setSetting } from '../lib/db';
import { PREVIEW_SPONSOR, BOOKED_SPONSORS, activeSponsor, localDay, shouldShowSponsor, type Sponsor } from '../lib/sponsor';
import { Icon, SoonBadge, type IconName } from '../components/Icon';
import { BottomNav } from '../components/BottomNav';
import { MrecSlot, TopBannerSlot, ADS_PREVIEW } from '../components/AdSlot';
import { SponsorPopup } from '../components/SponsorPopup';

type Tab = 'products' | 'recipes' | 'budget' | 'pantry' | 'articles';
const TABS: Tab[] = ['products', 'recipes', 'budget', 'pantry', 'articles'];

const CATEGORY_ICON: Record<CategoryId, IconName> = {
  meat: 'meat',
  poultry: 'poultry',
  vegetables: 'vegetables',
  dairy: 'dairy',
  pantry: 'pantryCan',
  dry: 'dry',
  household: 'household',
  other: 'other',
};

interface Props {
  activeTripId: number | null;
  onScan: () => void;
  onSearch: (category?: CategoryId) => void;
  onCart: () => void;
  onCommunity: () => void;
  onProfile: () => void;
}

/** The screen the app opens to: browse, search, and the way into a trip. Unbuilt sections carry a coming-soon cover. */
export function Explore({ activeTripId, onScan, onSearch, onCart, onCommunity, onProfile }: Props) {
  const [tab, setTab] = useState<Tab>('products');
  const [tip, setTip] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const tips = useRef<HTMLDivElement>(null);

  // Launch popup: only when a sponsor is booked, once a day, never mid-trip. The dev app previews it with ?sponsor.
  useEffect(() => {
    const today = localDay(new Date());
    const preview = ADS_PREVIEW && new URLSearchParams(window.location.search).has('sponsor');
    const booked = preview ? PREVIEW_SPONSOR : activeSponsor(BOOKED_SPONSORS, today);
    if (!booked) return;
    getSetting('sponsorShownDay').then((last) => {
      const lastShownDay = preview ? null : (last ?? null);
      if (shouldShowSponsor({ sponsor: booked, tripActive: activeTripId != null, lastShownDay, today })) setSponsor(booked);
    });
  }, [activeTripId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  function closeSponsor() {
    setSponsor(null);
    void setSetting('sponsorShownDay', localDay(new Date()));
  }

  function onTipsScroll() {
    const el = tips.current;
    if (!el || !el.firstElementChild) return;
    const step = (el.firstElementChild as HTMLElement).offsetWidth + 10;
    setTip(Math.min(S.explore.tips.length - 1, Math.round(el.scrollLeft / step)));
  }

  const startLabel = activeTripId ? S.explore.continueTrip : S.explore.startShopping;

  return (
    <main className="screen explore with-nav">
      <TopBannerSlot />

      <nav className="explore-tabs" aria-label={S.explore.sections}>
        <img className="explore-logo" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt={S.appName} />
        {TABS.map((t) => {
          const label = S.explore.tabs[t];
          const soon = t !== 'products';
          return (
            <button key={t} className={`explore-tab ${tab === t ? 'on' : ''}`} aria-pressed={tab === t} aria-label={soon ? S.explore.soonAria(label) : label} onClick={() => setTab(t)}>
              <Icon name={t} size={28} stroke={1.9} />
              <span>{label}</span>
              {soon && <SoonBadge />}
            </button>
          );
        })}
      </nav>

      <div className="explore-body">
        <button className="search-open" onClick={() => onSearch()} aria-label={S.search.open}>
          <Icon name="search" size={22} stroke={2.5} />
          <span>{S.search.openHint}</span>
        </button>

        {notice && <p className="toast">{notice}</p>}

        {tab === 'products' ? (
          <>
            <section className="tips" aria-label={S.explore.tipsLabel}>
              <div className="tips-track" ref={tips} onScroll={onTipsScroll}>
                {S.explore.tips.map((t, i) => (
                  <article key={t.title} className={`tip ${i === 0 ? 'tip-hero' : ''}`}>
                    <div className="tip-text">
                      <span className="label">{S.explore.tipOf(i + 1, S.explore.tips.length)}</span>
                      <h2>{t.title}</h2>
                      <p>{t.body}</p>
                      <button className="btn primary tip-btn" onClick={onScan}>
                        {startLabel}
                      </button>
                    </div>
                    {i === 0 && (
                      <div className="tip-sample" aria-hidden="true">
                        <span className="label">{S.explore.sampleTotal}</span>
                        <strong>₱862.75</strong>
                        <div className="tip-bar">
                          <div />
                        </div>
                        <small>{S.explore.sampleBudget}</small>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div className="dots" aria-hidden="true">
                {S.explore.tips.map((t, i) => (
                  <span key={t.title} className={i === tip ? 'on' : ''} />
                ))}
              </div>
            </section>

            <section aria-labelledby="cat-h">
              <h2 id="cat-h" className="explore-h">{S.explore.categories}</h2>
              <div className="cat-grid">
                {CATEGORIES.map((c) => (
                  <button key={c.id} className="cat-tile" style={{ background: c.color, color: c.ink }} onClick={() => onSearch(c.id)}>
                    <span>{c.label}</span>
                    <Icon name={CATEGORY_ICON[c.id]} size={30} stroke={1.8} />
                  </button>
                ))}
              </div>
            </section>

            <MrecSlot />

            <section className="reserved" aria-labelledby="usual-h">
              <h2 id="usual-h" className="explore-h">{S.explore.usual}</h2>
              <div className="reserved-skeleton" aria-hidden="true">
                <div />
                <div />
                <div />
              </div>
              <div className="soon-cover">
                <span className="soon-pill">{S.soon.badge}</span>
                <span>{S.explore.usualSoon}</span>
              </div>
            </section>
          </>
        ) : (
          <SoonPanel tab={tab} onBack={() => setTab('products')} onCart={onCart} />
        )}
      </div>

      <button className="chat-fab" aria-label={S.explore.chat} onClick={() => setNotice(S.explore.chatSoon)}>
        <Icon name="chat" size={28} />
        <SoonBadge />
      </button>

      <BottomNav current="explore" onExplore={() => setTab('products')} onCart={onCart} onScan={onScan} onCommunity={onCommunity} onProfile={onProfile} />

      {sponsor && <SponsorPopup sponsor={sponsor} onClose={closeSponsor} />}
    </main>
  );
}

function SoonPanel({ tab, onBack, onCart }: { tab: Tab; onBack: () => void; onCart: () => void }) {
  return (
    <section className="soon-panel">
      <div className="soon-skeleton" aria-hidden="true">
        <div className="wide" />
        <div />
        <div />
        <div />
        <div />
      </div>
      <div className="soon-card">
        <span className="soon-pill">{S.soon.badge}</span>
        <h2>{S.soon.titles[tab]}</h2>
        <p>{S.soon.bodies[tab] ?? S.soon.body}</p>
        {tab === 'budget' ? (
          <button className="btn secondary" onClick={onCart}>
            {S.soon.openCart}
          </button>
        ) : (
          <button className="btn secondary" onClick={onBack}>
            {S.soon.backToProducts}
          </button>
        )}
      </div>
    </section>
  );
}
