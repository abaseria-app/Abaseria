import { S } from '../strings';

// Reserved AdMob slots. AdMob only serves inside a native Android/iOS build, so until the Play Store (Capacitor)
// build exists these are empty placeholders, and only the dev app draws them. The live app collapses them to
// nothing so shoppers never see an empty box. Sizes are AdMob's standard BANNER and MEDIUM_RECTANGLE.
export const ADS_PREVIEW = import.meta.env.MODE !== 'production';

/** 320 × 50 strip at the very top of Explore, with a 16px gap before the tab row (AdMob's accidental-click rule). */
export function TopBannerSlot() {
  if (!ADS_PREVIEW) return null;
  return (
    <div className="ad-top">
      <div className="ad-box ad-banner" role="note" aria-label={`${S.ads.space}, ${S.ads.banner}`}>
        <span className="ad-tag">{S.ads.ad}</span>
        <span>
          {S.ads.space} · {S.ads.banner}
        </span>
      </div>
    </div>
  );
}

/** 300 × 250 medium rectangle in the page flow, after the category tiles. */
export function MrecSlot() {
  if (!ADS_PREVIEW) return null;
  return (
    <section className="ad-card" aria-label={S.ads.sponsored}>
      <div className="ad-card-head">
        <span className="label">{S.ads.sponsored}</span>
        <span className="ad-tag">{S.ads.ad}</span>
      </div>
      <div className="ad-box ad-mrec">
        <strong>{S.ads.space}</strong>
        <span>{S.ads.mrec}</span>
      </div>
    </section>
  );
}
