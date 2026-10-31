import { useState } from 'react';
import { S } from '../strings';
import { prepareImage, readTag, type OcrResult } from '../lib/ocr';
import { formatPeso } from '../lib/money';

interface Row {
  name: string;
  url: string;
  result: OcrResult | null;
  verdict: boolean | null;
}

/** Checkpoint 1: run the tag reader on real shelf-tag photos before any shopper sees the app. */
export function OcrCheck({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    const out: Row[] = list.map((f) => ({ name: f.name, url: URL.createObjectURL(f), result: null, verdict: null }));
    setRows(out);
    for (let i = 0; i < list.length; i++) {
      setProgress([i + 1, list.length]);
      try {
        const bmp = await createImageBitmap(list[i]);
        out[i] = { ...out[i], result: await readTag(prepareImage(bmp)) };
      } catch (e) {
        console.error(e);
      }
      setRows([...out]);
    }
    setProgress(null);
  }

  const judged = rows.filter((r) => r.verdict != null);
  const right = rows.filter((r) => r.verdict).length;
  const times = rows.flatMap((r) => (r.result ? [r.result.ms] : []));
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  return (
    <main className="screen ocrcheck">
      <header className="topbar">
        <button className="link" onClick={onBack}>{S.settings.back}</button>
        <h1>{S.ocrCheck.title}</h1>
        <span className="spacer" />
      </header>

      <label className="btn primary wide">
        {S.ocrCheck.pick}
        <input type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
      </label>
      {progress && <p className="hint">{S.ocrCheck.reading(progress[0], progress[1])}</p>}

      {judged.length > 0 && (
        <div className={`score ${judged.length === rows.length ? (right >= Math.ceil(rows.length * 0.8) ? 'pass' : 'fail') : ''}`}>
          <strong>{S.ocrCheck.score(right, judged.length)}</strong>
          {times.length > 0 && <span>{S.ocrCheck.avgTime(avg)}</span>}
          {judged.length === rows.length && <span>{right >= Math.ceil(rows.length * 0.8) ? S.ocrCheck.pass : S.ocrCheck.fail}</span>}
        </div>
      )}

      <ul className="ocr-rows">
        {rows.map((r, i) => (
          <li key={i}>
            <img src={r.url} alt={r.name} />
            <div>
              {r.result ? (
                <>
                  <div className="chips">
                    {r.result.candidates.length === 0 && <span className="hint">{S.ocrCheck.none}</span>}
                    {r.result.candidates.map((c, j) => (
                      <span key={j} className="chip">
                        {c.bundleQty ? S.item.bundleChip(c.bundleQty, formatPeso(c.centavos)) : formatPeso(c.centavos)}
                        {c.unit && c.unit !== 'pc' ? ` ${S.item.unit[c.unit]}` : ''}
                      </span>
                    ))}
                  </div>
                  {r.result.nameGuess && <p className="hint">{r.result.nameGuess}</p>}
                  <p className="label">{S.ocrCheck.question}</p>
                  <div className="seg">
                    {[true, false].map((v) => (
                      <button
                        key={String(v)}
                        className={r.verdict === v ? 'on' : ''}
                        onClick={() => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, verdict: v } : x)))}
                      >
                        {v ? S.ocrCheck.right : S.ocrCheck.wrong}
                      </button>
                    ))}
                  </div>
                  <details>
                    <summary className="hint">OCR text ({(r.result.ms / 1000).toFixed(1)} s)</summary>
                    <pre>{r.result.lines.map((l) => `${l.text}  [h${l.height}]`).join('\n')}</pre>
                  </details>
                </>
              ) : (
                <div className="spinner dark" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
