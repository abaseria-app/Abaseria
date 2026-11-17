import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';
import type { Account } from '../lib/auth';
import { hideGooglePhoto, initial, loadPhoto, removePhoto, uploadPhoto, type PhotoState } from '../lib/photo';

/** The shopper's photo, name and email at the top of the Profile tab, with ways to change the photo. */
export function ProfilePhoto({ account }: { account: Account }) {
  const [state, setState] = useState<PhotoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleBroken, setGoogleBroken] = useState(false);
  const selfie = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const refresh = () =>
    loadPhoto()
      .then((s) =>
        setState((old) => {
          if (old?.uploaded) URL.revokeObjectURL(old.uploaded);
          return s;
        }),
      )
      .catch(() => undefined);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);
  useEffect(() => () => { if (state?.uploaded) URL.revokeObjectURL(state.uploaded); }, [state?.uploaded]);

  async function act(work: () => Promise<void>) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setError(S.profile.photo.offline);
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch {
      setError(S.profile.photo.failed);
    } finally {
      setBusy(false);
    }
  }

  function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void act(() => uploadPhoto(file));
  }

  const google = state && !state.googleHidden && !googleBroken ? state.google : null;
  const src = state?.uploaded ?? google;

  return (
    <section className="card profile-photo">
      <div className="profile-photo-top">
        {src ? (
          <img className="avatar" src={src} alt={S.profile.photo.alt} referrerPolicy="no-referrer" onError={() => !state?.uploaded && setGoogleBroken(true)} />
        ) : (
          <span className="avatar avatar-initial" aria-hidden="true">{initial(account.name, account.email)}</span>
        )}
        <div className="profile-photo-who">
          {account.name && <strong>{account.name}</strong>}
          {account.email && <span className="hint small">{account.email}</span>}
          <span className="hint small">{S.profile.photo.onlyYou}</span>
        </div>
      </div>
      {busy && <p className="hint">{S.profile.photo.saving}</p>}
      {error && <p className="hint profile-error" role="alert">{error}</p>}
      <div className="profile-photo-actions">
        <button className="chip" disabled={busy} onClick={() => selfie.current?.click()}>{S.profile.photo.selfie}</button>
        <button className="chip" disabled={busy} onClick={() => gallery.current?.click()}>{S.profile.photo.choose}</button>
        {state?.uploaded ? (
          <button
            className="chip ghost"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await removePhoto();
                // Show the change at once, whatever the next check returns.
                setState((old) => {
                  if (old?.uploaded) URL.revokeObjectURL(old.uploaded);
                  return old ? { ...old, uploaded: null } : old;
                });
              })
            }
          >
            {S.profile.photo.remove}
          </button>
        ) : (
          state?.google && (
            <button className="chip ghost" disabled={busy} onClick={() => void act(() => hideGooglePhoto(!state.googleHidden))}>
              {state.googleHidden ? S.profile.photo.showGoogle : S.profile.photo.hideGoogle}
            </button>
          )
        )}
      </div>
      <input ref={selfie} type="file" accept="image/*" capture="user" hidden onChange={picked} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={picked} />
    </section>
  );
}
