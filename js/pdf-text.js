// Turns a PDF price list into text lines, one per printed row. PDFs store text as positioned
// fragments (often whole columns at a time), so plain copy-paste scrambles tables. Here we
// group fragments by their vertical position and order them left to right; a wide horizontal
// gap becomes a tab, so the result reads like rows copied from a spreadsheet.
// pdf.js is loaded on first use only.

const PDFJS_VERSION = '4.10.38';
const PDFJS = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let pdfjsReady = null;

function loadPdfJs() {
  pdfjsReady ??= import(PDFJS).then(pdfjs => {
    // Browsers won't start a worker straight from another origin; a same-origin blob that
    // imports it is allowed (cdnjs serves it with CORS).
    try {
      const shim = URL.createObjectURL(new Blob([`import "${WORKER}";`], { type: 'text/javascript' }));
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(shim, { type: 'module' });
    } catch {
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER;
    }
    return pdfjs;
  });
  return pdfjsReady;
}

export async function pdfToLines(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const words = items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.height || i.transform[3]) || 8 }));

    // Rows: fragments whose baselines are within a fraction of the text height of each other.
    words.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const w of words) {
      const row = rows.find(r => Math.abs(r.y - w.y) <= Math.max(2, w.h * 0.45));
      if (row) row.items.push(w);
      else rows.push({ y: w.y, items: [w] });
    }
    rows.sort((a, b) => b.y - a.y);

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const it of row.items) {
        if (end != null) {
          const gap = it.x - end;
          line += gap > Math.max(6, it.h * 0.9) ? '\t' : gap > 0.5 ? ' ' : '';
        }
        line += it.s;
        end = it.x + it.w;
      }
      if (line.trim()) lines.push(line.replace(/[  ]+/g, ' ').trim());
    }
    page.cleanup();
  }
  doc.destroy();
  return lines;
}
