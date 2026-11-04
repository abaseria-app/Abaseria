import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';
import { GUIDE, guideToSourceRect, prepareImage, readTag, type OcrResult } from '../lib/ocr';
import { ItemEditor, type ItemSubmit } from './ItemEditor';
import { logEvent } from '../lib/events';
import { getDetector, scanFrame } from '../lib/barcode';
import { makeThumb } from '../lib/thumb';
import { recallBarcode, type CaptureMethod, type Item, type Recall } from '../lib/db';
import { formatPeso } from '../lib/money';
import { SHARING_ON, sharedPhoto, sharedPrice } from '../lib/sync';

/**
 * barcode: live camera looking for a package barcode, no tap needed
 * camera:  live camera aimed at the shelf tag, tap the shutter
 * lookup:  barcode read, asking the shared database for other shoppers' price (2 seconds at most)
 */
type Step = 'barcode' | 'lookup' | 'camera' | 'nocam' | 'reading' | 'confirm' | 'type' | 'recall';

interface Props {
  tripId: number;
  branchUuid: string | null;
  startTyped?: boolean;
  recent: string[];
  fallbackName: string;
  onAdd: (v: ItemSubmit, method: CaptureMethod, msSinceOpen: number) => void;
  onClose: () => void;
}

/** How often the barcode step looks at the camera frame. */
const SCAN_EVERY_MS = 200;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

/**
 * Barcode -> (known here? confirm price : snap tag -> pick price) -> Add.
 * Phones that can't read barcodes start at the tag. "Type it" works from any step.
 */
export function Capture({ tripId, branchUuid, startTyped, recent, fallbackName, onAdd, onClose }: Props) {
  const [step, setStep] = useState<Step>(startTyped ? 'type' : 'barcode');
  const [result, setResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState(false);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [recall, setRecall] = useState<Recall | null>(null);
  const [aimNote, setAimNote] = useState<string | null>(null);
  /** Package photo from the barcode read; the tag photo fills it in when there's no barcode. */
  const thumbRef = useRef<string | null>(null);
  /** Published photo of this barcode from the shared database, when one arrives in time. Beats our own frame. */
  const sharedThumbRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openedAt = useRef(performance.now());
  const usedCamera = useRef(!startTyped);

  useEffect(() => {
    logEvent('capture_open', tripId, { method: startTyped ? 'typed' : 'barcode' });
  }, [tripId, startTyped]);

  // Live camera for both the barcode and the tag step; the stream is opened once and reused.
  useEffect(() => {
    if (step !== 'camera' && step !== 'barcode') return;
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

  // Barcode step: look at a frame every 200 ms until a valid barcode shows up.
  useEffect(() => {
    if (step !== 'barcode') return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      const detector = await getDetector();
      if (stop) return;
      if (!detector) {
        // This browser can't read barcodes (iPhones today). Go straight to the tag.
        logEvent('barcode_unsupported', tripId, {});
        setStep('camera');
        return;
      }
      const tick = async () => {
        if (stop) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          try {
            const hit = await scanFrame(detector, v);
            if (hit && !stop) {
              stop = true;
              navigator.vibrate?.(40);
              // The package is in view right now; scale stickers are left for the tag photo.
              if (hit.code) thumbRef.current = makeThumb(v);
              await found(hit.code);
              return;
            }
          } catch {
            /* a frame that fails to decode is just skipped */
          }
        }
        timer = setTimeout(tick, SCAN_EVERY_MS);
      };
      tick();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // found() only reads props that don't change during a capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tripId]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function found(code: string | null) {
    const ms = Math.round(performance.now() - openedAt.current);
    if (!code) {
      // Store scale sticker: the sticker itself is the "tag".
      logEvent('barcode_scanned', tripId, { kind: 'scale_sticker', ms });
      setAimNote(S.capture.scaleSticker);
      setStep('camera');
      return;
    }
    setBarcode(code);
    // Doesn't hold up the scan: if the photo arrives before Add, it's used; if not, our own frame is.
    if (SHARING_ON) sharedPhoto(code).then((p) => (sharedThumbRef.current = p));
    let r = await recallBarcode(code, branchUuid);
    logEvent('barcode_scanned', tripId, { kind: r ? (r.sameBranch ? 'known_here' : 'known_elsewhere') : 'new', ms });
    if (!r?.sameBranch && SHARING_ON) {
      // Not seen here by this phone: ask whether other shoppers have.
      setStep('lookup');
      const t0 = performance.now();
      const shared = await sharedPrice(code, branchUuid);
      logEvent('shared_lookup', tripId, { hit: !!shared, ms: Math.round(performance.now() - t0) });
      if (shared) {
        if (!shared.item.label && r) shared.item.label = r.item.label;
        r = shared;
      }
    }
    setRecall(r);
    if (r?.sameBranch) {
      setStep('recall');
    } else {
      setAimNote(S.capture.nowTag);
      setStep('camera');
    }
  }

  function skipBarcode() {
    logEvent('barcode_skipped', tripId, {});
    setAimNote(null);
    setStep('camera');
  }

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
    if (!thumbRef.current) thumbRef.current = makeThumb(v, crop);
    const canvas = prepareImage(v, crop);
    v.pause();
    runOcr(canvas);
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    if (!thumbRef.current) thumbRef.current = makeThumb(bmp);
    runOcr(prepareImage(bmp));
  }

  function cancel() {
    logEvent('capture_abandoned', tripId, { step: step === 'nocam' ? 'camera' : step, had_barcode: !!barcode });
    onClose();
  }

  function add(v: ItemSubmit, fromRecall: boolean) {
    const method: CaptureMethod = fromRecall
      ? v.priceTouched
        ? 'typed'
        : recall?.shared
          ? 'shared'
          : 'recall'
      : !usedCamera.current
        ? 'typed'
        : v.chosenRank === 'typed' || v.editedAfterChoice
          ? 'tag+typed'
          : 'tag';
    const ms = Math.round(performance.now() - openedAt.current);
    logEvent('price_chosen', tripId, { rank: fromRecall ? 'recall' : v.chosenRank, edited_after: v.editedAfterChoice || (fromRecall && v.priceTouched) });
    // Typed items keep no photo, even if the camera was open earlier in this capture.
    const own = !usedCamera.current && !barcode ? null : thumbRef.current;
    const shared = barcode ? sharedThumbRef.current : null;
    onAdd({ ...v, barcode, thumb: shared ?? own, thumbSource: shared ? 'shared' : own ? 'camera' : null }, method, ms);
  }

  // Known at this branch: last name and price, shopper checks the tag and taps Add.
  if (step === 'recall' && recall) {
    const last: Item = { ...recall.item, quantity: 1, weightGrams: null };
    return (
      <ItemEditor
        key={`recall-${barcode}`}
        title={S.item.addTitle}
        submitLabel={S.item.add}
        initial={last}
        recallNote={(recall.shared ? S.item.sharedSeen : S.item.lastSeen)(formatPeso(recall.item.unitPriceCentavos), shortDate(recall.item.createdAt))}
        barcode={barcode}
        recent={recent}
        fallbackName={fallbackName}
        onSubmit={(v) => add(v, true)}
        onCancel={cancel}
        retakeLabel={S.capture.snapTagInstead}
        onRetake={() => {
          setAimNote(S.capture.nowTag);
          setStep('camera');
        }}
      />
    );
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
        knownName={recall?.item.label ?? null}
        barcode={barcode}
        promoHint={isTag ? result?.promoHint : false}
        notice={isTag ? (ocrError ? S.capture.ocrFailed : result && result.candidates.length === 0 ? S.capture.noPrice : null) : null}
        recent={recent}
        fallbackName={fallbackName}
        onSubmit={(v) => add(v, false)}
        onCancel={cancel}
        onRetake={isTag ? () => setStep(streamRef.current ? 'camera' : 'nocam') : undefined}
      />
    );
  }

  const scanning = step === 'barcode';
  return (
    <div className="camera" role="dialog" aria-label={S.shop.snap}>
      {step !== 'nocam' && (
        <>
          <video ref={videoRef} playsInline muted />
          <div
            ref={guideRef}
            className={`guide ${scanning ? 'barcode' : ''}`}
            style={
              scanning
                ? undefined
                : { left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }
            }
          />
          <p className="aim">
            {step === 'reading' ? S.capture.reading : step === 'lookup' ? S.capture.lookingUp : scanning ? S.capture.aimBarcode : aimNote ?? S.capture.aim}
          </p>
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
        {scanning && <button className="btn secondary no-barcode" onClick={skipBarcode}>{S.capture.noBarcode}</button>}
        {step === 'camera' && <button className="shutter" aria-label={S.shop.snap} onClick={shoot} />}
        {(step === 'reading' || step === 'lookup') && <div className="spinner" aria-label={step === 'lookup' ? S.capture.lookingUp : S.capture.reading} />}
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
