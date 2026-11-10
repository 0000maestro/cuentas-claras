// Copia el lector de imágenes (OCR) a public/ocr para servirlo desde el mismo dominio,
// sin depender de un CDN externo. Se ejecuta antes de `dev` y `build`.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
mkdirSync(out, { recursive: true })
const nm = (...p) => join(root, 'node_modules', ...p)

cpSync(nm('tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'])
  cpSync(nm('tesseract.js-core', f), join(out, f))
cpSync(nm('@tesseract.js-data', 'spa', '4.0.0_best_int', 'spa.traineddata.gz'), join(out, 'spa.traineddata.gz'))
console.log('OCR listo en public/ocr')
