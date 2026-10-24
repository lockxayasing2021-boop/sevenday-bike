// Sevenday Bike — ດຶງສິນຄ້າ + ຮູບ ຈາກ Google (Apps Script / Drive) ມາໄວ້ໃນ GitHub Pages
//  • data/catalog.json : ສິນຄ້າທັງໝົດ (ສະແດງທັນທີ ບໍ່ຕ້ອງລໍ API)
//  • img/p/<id>-<w>.webp : ຮູບຂະໜາດເລັກ (600 / 1200 / 1920) ໂຫຼດໄວຈາກ CDN ຂອງ GitHub
// ແລ່ນໂດຍ GitHub Action (.github/workflows/sync-catalog.yml) ທຸກ 15 ນາທີ
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AwsClient } from 'aws4fetch';

const ROOT = process.env.SITE_ROOT || process.cwd();
const API = process.env.API_URL, SECRET = process.env.API_SECRET;
const IMG_BASE = process.env.IMG_BASE || 'https://lh3.googleusercontent.com/d/';
const OUT_JSON = path.join(ROOT, 'data/catalog.json'), IMG_DIR = path.join(ROOT, 'img/p');
const SIZES = [600, 1200], BIG = 1920, CONC = 4, MAX_NEW = Number(process.env.MAX_NEW || 400);
const log = (...a) => console.log(...a);
// Cloudflare R2: ຮູບ WebP ຂອງໜ້າເວັບເກັບທີ່ R2 (ຟຣີ 10GB) — ຕັ້ງ Secrets ໃນ GitHub: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
const E = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, /^R2_/.test(k) ? String(v).trim() : v])), R2 = E.R2_ENDPOINT && E.R2_ACCESS_KEY_ID && E.R2_SECRET_ACCESS_KEY && E.R2_BUCKET && E.R2_PUBLIC_URL
  ? { url: E.R2_ENDPOINT.replace(/\/$/, '') + '/' + E.R2_BUCKET, pub: E.R2_PUBLIC_URL.replace(/\/$/, ''),
      c: new AwsClient({ accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' }) } : null;
const R2_LIST = path.join(ROOT, 'data/r2-uploaded.json');

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      const t = await r.text(); const j = JSON.parse(t);
      if (!j.ok) throw new Error(j.error || 'API error');
      return j.data;
    } catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 3000 * i)); }
  }
}
async function getBytes(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!/^image\//.test(ct)) throw new Error('not an image: ' + ct);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 2000 * i)); }
  }
}
const stable = o => JSON.stringify(o, (k, v) => k === 't' ? undefined : v);

const data = await getJSON(`${API}?action=exportCatalog&secret=${SECRET}`);
const text = JSON.stringify(data);

// ທຸກຮູບທີ່ໃຊ້ (Drive ID) + ຂະໜາດທີ່ຕ້ອງການ
const want = new Map();
for (const m of text.matchAll(/https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]{10,})(?:=w(\d+))?/g)) {
  const id = m[1], w = Number(m[2] || 800);
  want.set(id, Math.max(want.get(id) || 0, w));
}
let old = {};
try { old = JSON.parse(await fs.readFile(OUT_JSON, 'utf8')).imgs || {}; } catch (_) {}
await fs.mkdir(IMG_DIR, { recursive: true });

const imgs = {}, todo = [];
for (const [id, w] of want) {
  const sizes = w > 1600 ? [...SIZES, BIG] : SIZES;
  const have = old[id] || [];
  if (sizes.every(s => have.includes(s))) imgs[id] = have;
  else todo.push([id, sizes]);
}
log(`images: ${want.size} used, ${Object.keys(imgs).length} ready, ${todo.length} to convert`);

let done = 0, failed = 0;
const queue = todo.slice(0, MAX_NEW);
async function worker() {
  for (let job; (job = queue.shift());) {
    const [id, sizes] = job;
    try {
      const src = await getBytes(`${IMG_BASE}${id}=w${Math.max(...sizes)}`);
      const meta = await sharp(src).metadata();
      const made = [];
      for (const s of sizes) {
        const file = path.join(IMG_DIR, `${id}-${s}.webp`);
        await sharp(src).rotate().resize({ width: s, height: s, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: s <= 600 ? 78 : 80, alphaQuality: 90, effort: 5 }).toFile(file);
        made.push(s);
      }
      imgs[id] = made; done++;
      if (done % 25 === 0) log(`  … ${done} converted`);
    } catch (e) { failed++; log(`  ✗ ${id}: ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// ຮູບທີ່ແປງບໍ່ສຳເລັດ: ໃຊ້ໄຟລ໌ເກົ່າໄປກ່ອນ (ຖ້າມີ) ແລ້ວລອງໃໝ່ຮອບໜ້າ
for (const [id] of todo) if (!imgs[id] && old[id]) imgs[id] = old[id];
// ລຶບຮູບທີ່ບໍ່ໄດ້ໃຊ້ແລ້ວ
const keep = new Set(Object.entries(imgs).flatMap(([id, ss]) => ss.map(s => `${id}-${s}.webp`)));
let removed = 0;
for (const f of await fs.readdir(IMG_DIR)) if (!keep.has(f)) { await fs.unlink(path.join(IMG_DIR, f)); removed++; }

const imgsSorted = Object.fromEntries(Object.keys(imgs).sort().map(k => [k, imgs[k]]));
// ອັບໂຫລດຮູບ WebP ທີ່ຍັງບໍ່ມີໃນ R2 (ຈົດລາຍຊື່ໄວ້ໃນ data/r2-uploaded.json — ບໍ່ອັບຊ້ຳ)
let imgBase = 'img/p/';
if (R2) {
  let sent = {}; try { sent = JSON.parse(await fs.readFile(R2_LIST, 'utf8')); } catch (_) {}
  const want2 = [...keep].filter(f => !sent[f]);
  let up = 0, bad = 0; const errs = [];
  const q2 = want2.slice();
  async function upWorker() {
    for (let f; (f = q2.shift());) {
      try {
        const r = await R2.c.fetch(R2.url + '/p/' + f, { method: 'PUT', body: await fs.readFile(path.join(IMG_DIR, f)),
          headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' } });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
        sent[f] = 1; up++;
      } catch (e) { bad++; if (errs.length < 3) errs.push(e.message.slice(0, 300)); log('  ✗ R2 ' + f + ': ' + e.message); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, upWorker));
  for (const f of Object.keys(sent)) if (!keep.has(f)) delete sent[f];
  await fs.mkdir(path.dirname(R2_LIST), { recursive: true });
  await fs.writeFile(R2_LIST, JSON.stringify(Object.fromEntries(Object.keys(sent).sort().map(k => [k, 1]))));
  log(`R2: uploaded ${up}, failed ${bad}, total ${Object.keys(sent).length}/${keep.size}`);
  // ສະຖານະ R2 (ບໍ່ມີລະຫັດລັບ) — ໃຫ້ກວດໄດ້ໂດຍບໍ່ຕ້ອງເປີດ log ຂອງ GitHub
  const host = (() => { try { return new URL(E.R2_ENDPOINT).host.replace(/^[0-9a-f]{8}/, '********'); } catch (_) { return 'invalid R2_ENDPOINT'; } })();
  await fs.writeFile(path.join(ROOT, 'data/r2-status.json'), JSON.stringify({ t: new Date().toISOString(), endpoint_host: host,
    endpoint_has_path: /^https?:\/\/[^/]+\/./.test(E.R2_ENDPOINT || ''), bucket: E.R2_BUCKET, public_url: E.R2_PUBLIC_URL,
    uploaded: up, failed: bad, total: Object.keys(sent).length, want: keep.size, errors: errs }, null, 1));
  if ([...keep].every(f => sent[f])) imgBase = R2.pub + '/p/';
}
const out = { t: data.t, imgs: imgsSorted, img_base: imgBase, products: data.products, site: data.site || {} };
let prev = null; try { prev = JSON.parse(await fs.readFile(OUT_JSON, 'utf8')); } catch (_) {}
if (!prev || stable(prev) !== stable(out)) {
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.writeFile(OUT_JSON, JSON.stringify(out));
  log(`catalog.json written: ${data.products.length} products`);
} else log('catalog.json unchanged');
log(`converted ${done}, failed ${failed}, removed ${removed}, left for next run ${Math.max(0, todo.length - MAX_NEW)}`);
