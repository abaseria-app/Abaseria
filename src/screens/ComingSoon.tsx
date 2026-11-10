import { S } from '../strings';
import { BottomNav } from '../components/BottomNav';
import { TopBannerSlot } from '../components/AdSlot';

export type SoonFeature = 'community' | 'profile';

interface Props {
  feature: SoonFeature;
  onExplore: () => void;
  onCart: () => void;
  onScan: () => void;
  onCommunity: () => void;
  onProfile: () => void;
  onSettings: () => void;
}

/** A bottom-bar tab that isn't built yet: the space is reserved, with a coming-soon cover over it. */
export function ComingSoon({ feature, onExplore, onCart, onScan, onCommunity, onProfile, onSettings }: Props) {
  return (
    <main className="screen explore with-nav">
      <TopBannerSlot />
      <header className="soon-header">
        <img className="explore-logo" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt={S.appName} />
        <h1>{S.nav[feature]}</h1>
      </header>
      <div className="explore-body">
        <section className="soon-panel">
          <div className="soon-skeleton posts" aria-hidden="true">
            <div className="wide" />
            <div className="wide" />
          </div>
          <div className="soon-card">
            <span className="soon-pill">{S.soon.badge}</span>
            <h2>{S.soon.titles[feature]}</h2>
            <p>{S.soon.bodies[feature] ?? S.soon.body}</p>
            {feature === 'profile' ? (
              <button className="btn secondary" onClick={onSettings}>
                {S.soon.openSettings}
              </button>
            ) : (
              <button className="btn primary" onClick={onScan}>
                {S.explore.startShopping}
              </button>
            )}
          </div>
        </section>
      </div>
      <BottomNav current={feature} onExplore={onExplore} onCart={onCart} onScan={onScan} onCommunity={onCommunity} onProfile={onProfile} />
    </main>
  );
}
