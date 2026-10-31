// Copies the OCR engine and English language data into public/tesseract
// so the app never needs a CDN and works fully offline after first load.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');
mkdirSync(out, { recursive: true });

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // LSTM-only cores. The worker picks the fastest one the phone supports.
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  // best_int: about 3 MB, faster than "best" with near-identical accuracy.
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

for (const [src, dest] of files) {
  const from = join(root, src);
  if (!existsSync(from)) {
    console.error(`Missing ${src}. Run npm install first.`);
    process.exit(1);
  }
  copyFileSync(from, join(out, dest));
}
console.log(`OCR assets copied to ${out}`);
