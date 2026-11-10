import { useEffect, useRef } from 'react';
import { S } from '../strings';
import type { Sponsor } from '../lib/sponsor';
import { Icon } from './Icon';

interface Props {
  sponsor: Sponsor;
  onClose: () => void;
}

/** The 3:5 launch card for a directly booked sponsor. Closing it (either way) counts as today's showing. */
export function SponsorPopup({ sponsor, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  const creative = sponsor.imageUrl ? (
    <img src={sponsor.imageUrl} alt={sponsor.alt} />
  ) : (
    <div className="sponsor-placeholder">
      <strong>{S.sponsor.placeholder}</strong>
      <span>{S.sponsor.placeholderSize}</span>
    </div>
  );

  return (
    <div className="sponsor-dim">
      <div className="sponsor-pop" role="dialog" aria-modal="true" aria-label={S.sponsor.label}>
        <button ref={close} className="sponsor-close" aria-label={S.sponsor.close} onClick={onClose}>
          <Icon name="close" size={20} stroke={2.6} />
        </button>
        <div className="sponsor-card">
          <div className="sponsor-head">
            <span className="label">{S.ads.sponsored}</span>
            <span className="ad-tag">{S.ads.ad}</span>
          </div>
          <div className="sponsor-creative">
            {sponsor.linkUrl ? (
              <a href={sponsor.linkUrl} target="_blank" rel="noopener noreferrer sponsored">
                {creative}
              </a>
            ) : (
              creative
            )}
          </div>
        </div>
        <button className="link light" onClick={onClose}>
          {S.sponsor.notToday}
        </button>
      </div>
    </div>
  );
}
