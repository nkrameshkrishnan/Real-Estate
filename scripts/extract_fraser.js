// Paste into the browser console on https://www.fraserinstitute.org (any page) to extract the
// ranking tables from the Ontario Report Card PDFs into a TSV for scripts/build_fraser.py.
// Update the two PDF paths when a new edition is published (links are on the study pages).
const PDFS = {
  E: '/sites/default/files/2026-01/ontario-elementary-school-rankings-2025.pdf',
  S: '/sites/default/files/2025-11/ontario-secondary-school-rankings-2025_0.pdf',
};
const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const re = /(?:^|\|)(\d{1,4})\|(\d{1,4}|n\/a|—|-)\|(p|q|—|n\/a|-)?\|?([^|]+?)\|([^|0-9][^|]*?)\|(10\.0|10|\d\.\d)\|(10\.0|10|\d\.\d|n\/a|—|-)(?=\||$)/g;
let out = '';
for (const [sec, path] of Object.entries(PDFS)) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await (await fetch(path)).arrayBuffer()) }).promise;
  const recs = new Map();
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent(); const rows = {};
    for (const it of tc.items) (rows[Math.round(it.transform[5])] ||= []).push([it.transform[4], it.str]);
    for (const y of Object.keys(rows)) {
      const line = rows[y].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('|').replace(/\|\s*\|/g, '|');
      let m; re.lastIndex = 0;
      while ((m = re.exec(line))) { const k = m[4].trim() + '|' + m[5].trim(); if (!recs.has(k)) recs.set(k, [m[1], m[4].trim(), m[5].trim(), m[6], /\d/.test(m[7]) ? m[7] : '', m[3] === 'p' ? 'up' : m[3] === 'q' ? 'down' : '']); }
    }
  }
  out += sec + '\n' + [...recs.values()].map(r => r.join('\t')).join('\n') + '\n';
}
const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out], { type: 'text/tab-separated-values' })), download: 'fraser.tsv' });
a.click();
