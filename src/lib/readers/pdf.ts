import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ReadOptions } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfContent { lines: string[]; pages: number; hasText: boolean; pageImages: () => Promise<HTMLCanvasElement[]> }

interface Item { str: string; x: number; y: number; w: number }

function itemsToLines(items: Item[]): string[] {
  // agrupa por altura (misma línea) y ordena de izquierda a derecha
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: Item[][] = []
  for (const it of sorted) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g[0].y - it.y) <= 2.5) g.push(it)
    else groups.push([it])
  }
  return groups.map(g => {
    g.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -Infinity
    for (const it of g) {
      const gap = it.x - end
      if (line && gap > 1) line += gap > 12 ? '   ' : ' '
      line += it.str
      end = it.x + it.w
    }
    return line.replace(/\s+$/, '')
  }).filter(l => l.trim())
}

export async function readPdf(file: File, opts: ReadOptions = {}): Promise<PdfContent> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const pw = opts.askPassword?.(reason === 2) ?? null
    if (pw === null) throw new Error('El PDF tiene clave y no se ingresó.')
    update(pw)
  }
  const doc = await task.promise
  const lines: string[] = []
  let chars = 0
  for (let p = 1; p <= doc.numPages; p++) {
    opts.onProgress?.(`Leyendo página ${p} de ${doc.numPages}…`)
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const items: Item[] = []
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })
      chars += it.str.length
    }
    lines.push(...itemsToLines(items))
  }
  const pageImages = async () => {
    const out: HTMLCanvasElement[] = []
    for (let p = 1; p <= Math.min(doc.numPages, 8); p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 2.2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width; canvas.height = viewport.height
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      out.push(canvas)
    }
    return out
  }
  return { lines, pages: doc.numPages, hasText: chars > 40 * doc.numPages, pageImages }
}
