import type { Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null
let progressCb: ((msg: string) => void) | undefined

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker('spa', 1, {
        workerPath: `${location.origin}/ocr/worker.min.js`,
        corePath: `${location.origin}/ocr`,
        langPath: `${location.origin}/ocr`,
        logger: m => { if (m.status === 'recognizing text') progressCb?.(`Leyendo la imagen… ${Math.round(m.progress * 100)}%`) },
      }),
    )
    workerPromise.catch(() => { workerPromise = null })
  }
  return workerPromise
}

async function toCanvas(src: Blob | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  if (src instanceof HTMLCanvasElement) return src
  const bmp = await createImageBitmap(src)
  // las capturas angostas se leen mejor ampliadas
  const scale = bmp.width < 1100 ? Math.min(2.5, 1500 / bmp.width) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Deja texto oscuro sobre fondo blanco: invierte las capturas en modo oscuro y amplifica la diferencia
 * respecto del fondo, para que el texto gris o de color (fechas, montos en verde) no se pierda.
 */
function normalize(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 16) { hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++ }
  // el fondo es el tono más frecuente
  let bg = 0
  for (let v = 1; v < 256; v++) if (hist[v] > hist[bg]) bg = v
  const dark = bg < 128
  const bgLevel = dark ? 255 - bg : bg
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    if (dark) g = 255 - g
    g = 255 - Math.max(0, Math.min(255, (bgLevel - g) * 2.4))
    d[i] = d[i + 1] = d[i + 2] = g
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export async function ocrLines(src: Blob | HTMLCanvasElement, onProgress?: (msg: string) => void): Promise<string[]> {
  progressCb = onProgress
  onProgress?.('Preparando el lector de imágenes…')
  const canvas = normalize(await toCanvas(src))
  const worker = await getWorker()
  const { data } = await worker.recognize(canvas)
  return data.text.split('\n').map(l => l.trim()).filter(Boolean)
}
