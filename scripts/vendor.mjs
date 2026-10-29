// Copies browser libraries and wake-word models from node_modules into public/ (committed, so hosting needs no build step).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const nm = 'node_modules';
const cp = (a, b) => { cpSync(a, b); console.log('copied', b); };
mkdirSync('public/vendor/ort', { recursive: true });
mkdirSync('public/vendor/oww', { recursive: true });
mkdirSync('public/models', { recursive: true });
cp(`${nm}/@supabase/supabase-js/dist/umd/supabase.js`, 'public/vendor/supabase.js');
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) cp(`${nm}/onnxruntime-web/dist/${f}`, `public/vendor/ort/${f}`);
const eng = readFileSync(`${nm}/openwakeword-wasm-browser/src/WakeWordEngine.js`, 'utf8').replace("from 'onnxruntime-web'", "from '/vendor/ort/ort.wasm.min.mjs'");
writeFileSync('public/vendor/oww/WakeWordEngine.js', eng); console.log('wrote public/vendor/oww/WakeWordEngine.js');
for (const f of ['melspectrogram.onnx', 'embedding_model.onnx', 'silero_vad.onnx', 'hey_jarvis_v0.1.onnx']) cp(`${nm}/openwakeword-wasm-browser/models/${f}`, `public/models/${f}`);
