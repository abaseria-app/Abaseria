import type { Notice } from '../lib/notices';
import { S } from '../strings';
import { Icon } from './Icon';

interface Props {
  notice: Notice;
  onClose: () => void;
}

/** A notice from Abaseria, in English with the Tagalog underneath when there is one. */
export function NoticeBanner({ notice, onClose }: Props) {
  return (
    <div className={`app-notice ${notice.kind}`} role={notice.kind === 'incident' ? 'alert' : 'status'}>
      <button className="app-notice-close" aria-label={S.notices.close} onClick={onClose}>
        <Icon name="close" size={18} stroke={2.6} />
      </button>
      <strong>{notice.title_en}</strong>
      <p>{notice.body_en}</p>
      {notice.title_tl && notice.body_tl && (
        <div lang="tl" className="app-notice-tl">
          <strong>{notice.title_tl}</strong>
          <p>{notice.body_tl}</p>
        </div>
      )}
    </div>
  );
}
