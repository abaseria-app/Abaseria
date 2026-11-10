import { S } from '../strings';
import { Icon, SoonBadge } from './Icon';

export type NavTab = 'explore' | 'cart' | 'community' | 'profile';

interface Props {
  current: NavTab;
  onExplore: () => void;
  onCart: () => void;
  onScan: () => void;
  onCommunity: () => void;
  onProfile: () => void;
}

/** The bar pinned to the bottom of Explore, Cart and the coming-soon screens. Scan is the big middle button. */
export function BottomNav({ current, onExplore, onCart, onScan, onCommunity, onProfile }: Props) {
  const tab = (id: NavTab, label: string, icon: 'search' | 'cart' | 'community' | 'profile', go: () => void, soon = false) => (
    <button className={`nav-item ${current === id ? 'on' : ''}`} aria-current={current === id ? 'page' : undefined} aria-label={soon ? S.explore.soonAria(label) : undefined} onClick={go}>
      <Icon name={icon} />
      <span>{label}</span>
      {soon && <SoonBadge />}
    </button>
  );
  return (
    <nav className="bottom-nav" aria-label={S.nav.label}>
      {tab('explore', S.nav.explore, 'search', onExplore)}
      {tab('cart', S.nav.cart, 'cart', onCart)}
      <button className="nav-item nav-scan" aria-label={S.nav.scanLabel} onClick={onScan}>
        <span className="nav-scan-ring">
          <Icon name="scan" size={32} />
        </span>
        <span>{S.nav.scan}</span>
      </button>
      {tab('community', S.nav.community, 'community', onCommunity, true)}
      {tab('profile', S.nav.profile, 'profile', onProfile, true)}
    </nav>
  );
}
