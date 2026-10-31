import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';
import { GUIDE, guideToSourceRect, prepareImage, readTag, type OcrResult } from '../lib/ocr';
import { ItemEditor, type ItemSubmit } from './ItemEditor';
import { logEvent } from '../lib/events';

type Step = 'camera' | 'nocam' | 'reading' | 'confirm' | 'type';

interface Props {
  tripId: number;
  startTyped?: boolean;
  recent: string[];
  fallbackName: string;
  onAdd: (v: ItemSubmit, method: 'tag' | 'tag+typed' | 'typed', msSinceOpen: number) => void;
  onClose: () => void;
}

/** Snap tag -> read -> pick price -> Add. Also hosts "Type it" so both paths share timing and logging. */
export function Capture({ tripId, startTyped, recent, fallbackName, onAdd, onClose }: Props) {
  const [step, setStep] = useState<Step>(startTyped ? 'type' : 'camera');
  const [result, setResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openedAt = useRef(performance.now());
  const usedCamera = useRef(!startTyped);

  useEffect(() => {
    logEvent('capture_open', tripId, { method: startTyped ? 'typed' : 'tag' });
  }, [tripId, startTyped]);

  useEffect(() => {
    if (step !== 'camera') return;
    let cancelled = false;
    (async () => {
      try {
        if (!streamRef.current) {
          streamRef.current = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        }
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play();
      } catch (e) {
        logEvent('camera_error', tripId, { reason: (e as Error).name });
        if (!cancelled) setStep('nocam');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, tripId]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function runOcr(canvas: HTMLCanvasElement) {
    setStep('reading');
    try {
      const r = await readTag(canvas);
      setResult(r);
      setOcrError(false);
      logEvent('ocr_done', tripId, { ms: r.ms, candidates: r.candidates.length, name_guessed: !!r.nameGuess });
    } catch (e) {
      console.error(e);
      setResult(null);
      setOcrError(true);
      logEvent('ocr_done', tripId, { ms: null, candidates: 0, error: String(e) });
    }
    setStep('confirm');
  }

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    navigator.vibrate?.(20);
    const crop = guideRef.current ? guideToSourceRect(v, guideRef.current) : undefined;
    const canvas = prepareImage(v, crop);
    v.pause();
    runOcr(canvas);
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    runOcr(prepareImage(bmp));
  }

  function cancel() {
    logEvent('capture_abandoned', tripId, { step: step === 'nocam' ? 'camera' : step === 'type' ? 'type' : step });
    onClose();
  }

  function add(v: ItemSubmit) {
    const method = !usedCamera.current ? 'typed' : v.chosenRank === 'typed' || v.editedAfterChoice ? 'tag+typed' : 'tag';
    const ms = Math.round(performance.now() - openedAt.current);
    logEvent('price_chosen', tripId, { rank: v.chosenRank, edited_after: v.editedAfterChoice });
    onAdd(v, method, ms);
  }

  if (step === 'confirm' || step === 'type') {
    const isTag = step === 'confirm';
    return (
      <ItemEditor
        key={isTag ? `tag-${result?.ms}` : 'typed'}
        title={S.item.addTitle}
        submitLabel={S.item.add}
        candidates={isTag ? result?.candidates ?? [] : undefined}
        nameGuess={isTag ? result?.nameGuess : null}
        promoHint={isTag ? result?.promoHint : false}
        notice={isTag ? (ocrError ? S.capture.ocrFailed : result && result.candidates.length === 0 ? S.capture.noPrice : null) : null}
        recent={recent}
        fallbackName={fallbackName}
        onSubmit={add}
        onCancel={cancel}
        onRetake={isTag ? () => setStep(streamRef.current ? 'camera' : 'nocam') : undefined}
      />
    );
  }

  return (
    <div className="camera" role="dialog" aria-label={S.shop.snap}>
      {step !== 'nocam' && (
        <>
          <video ref={videoRef} playsInline muted />
          <div
            ref={guideRef}
            className="guide"
            style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }}
          />
          <p className="aim">{step === 'reading' ? S.capture.reading : S.capture.aim}</p>
        </>
      )}
      {step === 'nocam' && (
        <div className="nocam">
          <p>{S.capture.cameraBlocked}</p>
          <label className="btn primary">
            {S.capture.takePhoto}
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
          </label>
        </div>
      )}
      <div className="camera-bar">
        <button className="link light" onClick={cancel}>{S.capture.cancel}</button>
        {step === 'camera' && <button className="shutter" aria-label={S.shop.snap} onClick={shoot} />}
        {step === 'reading' && <div className="spinner" aria-label={S.capture.reading} />}
        <button
          className="link light"
          onClick={() => {
            usedCamera.current = false;
            setStep('type');
          }}
        >
          {S.capture.typeInstead}
        </button>
      </div>
    </div>
  );
}
