// Сборка библиотеки раскрасок: node tools/build-library.cjs <список.json> [только-id]
// Нужен запущенный сервер из корня проекта: python3 -m http.server 8790 --bind 127.0.0.1
// Playwright берётся из NODE_PATH. Пишет data/<id>-<level>.json|.bin, data/thumbs/<id>.jpg и data/catalog.json.
const fs = require('fs'), path = require('path')
const { chromium } = require('@playwright/test')
const ROOT = path.resolve(__dirname, '..')
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const only = process.argv[3]
;(async () => {
  const b = await chromium.launch()
  const page = await b.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto('http://127.0.0.1:8790/tools/build.html'); await page.waitForFunction(() => window.ready)
  const catalog = []
  for (const p of spec.pictures) {
    const entry = { id: p.id, title: p.title, author: p.author || '', year: p.year || '', kind: p.kind, thumb: `data/thumbs/${p.id}.jpg`, credit: p.credit || '', levels: [] }
    for (const lv of p.levels) {
      if (only && only !== p.id) { if (p.cached) entry.levels.push(p.cached[lv.key]); continue }
      const job = { kind: p.kind, longSide: lv.longSide, opts: lv.opts }
      if (p.kind === 'code') job.module = '/' + p.module
      else { const buf = fs.readFileSync(p.image); job.dataUrl = 'data:image/jpeg;base64,' + buf.toString('base64'); job.opts = { ...lv.opts, longSide: lv.longSide }; if (p.inset != null) job.inset = p.inset }
      const out = await page.evaluate((j) => window.buildPicture(j), job)
      fs.writeFileSync(path.join(ROOT, 'data', `${p.id}-${lv.key}.json`), out.meta)
      fs.writeFileSync(path.join(ROOT, 'data', `${p.id}-${lv.key}.bin`), Buffer.from(out.rle, 'base64'))
      if (p.kind === 'code' || p.thumbFrom === 'preview') fs.writeFileSync(path.join(ROOT, entry.thumb), Buffer.from(out.preview.split(',')[1], 'base64'))
      else if (out.orig && lv === p.levels[0]) fs.writeFileSync(path.join(ROOT, entry.thumb), Buffer.from(out.orig.split(',')[1], 'base64'))
      if (out.crop && lv === p.levels[0]) console.log(`  обрезка ${p.id}: ${JSON.stringify(out.crop)}`)
      fs.writeFileSync(path.join(process.env.PREVIEW_DIR || '/tmp', `${p.id}-${lv.key}-preview.jpg`), Buffer.from(out.preview.split(',')[1], 'base64'))
      fs.writeFileSync(path.join(process.env.PREVIEW_DIR || '/tmp', `${p.id}-${lv.key}-outline.jpg`), Buffer.from(out.outline.split(',')[1], 'base64'))
      const bin = fs.statSync(path.join(ROOT, 'data', `${p.id}-${lv.key}.bin`)).size
      console.log(`${p.id} ${lv.key}: ${out.stats.w}×${out.stats.h}, областей ${out.stats.regions}, цветов ${out.stats.colors}, мин. радиус ${out.stats.minRad}, ${Math.round(bin / 1024)} КБ карта, ${out.stats.ms} мс`)
      entry.levels.push({ key: lv.key, label: lv.label, regions: out.stats.regions, colors: out.stats.colors })
    }
    catalog.push(entry)
  }
  if (!only) fs.writeFileSync(path.join(ROOT, 'data', 'catalog.json'), JSON.stringify({ pictures: catalog }, null, 1))
  await b.close()
})()
