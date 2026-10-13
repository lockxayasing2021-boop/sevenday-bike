/**
 * SEVENDAY ERP LITE — Module: REPAIR QUEUE — ตารางคิวซ่อม / Service
 *
 * ใช้ข้อมูลร่วมกับเว็บไซต์ sevendaybike.com (WebApiRouter) ผ่านชีตในไฟล์นี้:
 *   RepairQueue        — คิว 1 แถว = 1 คัน (จองจากเว็บ / แอดมินเว็บ / พนักงาน POS)
 *   RepairQueueConfig  — ตั้งค่า (ช่วงเวลา จำนวนรับ วันปิด) ซ่อนไว้ แก้ผ่านหน้าจอเท่านั้น
 *   RepairJobs         — งานซ่อมเดิมของ POS: งานที่รับหน้าร้าน (ไม่ได้จองคิว) นับเป็นคิวของวัน-ช่วงที่รับเข้ามาอัตโนมัติ
 * ฟังก์ชันที่หน้าเว็บ POS เรียก: getRepairQueueWeek, getRepairQueueSlots, bookRepairQueue,
 *   checkinRepairNow, estimateRepair, getRepairQueueServices,
 *   updateRepairQueue, blockRepairQueue, saveRepairQueueConfig, getRepairQueueByJob
 */

// ประเภทงาน (Basic / Standard / Ultimate …) ที่ผูก SKU ไว้ในแอดมินเว็บ → ใส่เป็นรายการค่าบริการในงานซ่อมให้อัตโนมัติ
function rqAddServiceLine_(jobId, service) {
  try { const sku = rq_().svcSku(service); if (sku) addPartToRepair(jobId, sku, 1); } catch (e) { Logger.log('rqAddServiceLine_: ' + e.message); }
}
function rq_() { return RepairQueueEngine_(SpreadsheetApp.getActiveSpreadsheet()); }
function rqFail_(e) { return { success: false, message: String(e && e.message || e).replace(/^QUEUE_\w+:\s*/, ''), code: (String(e && e.message || e).match(/^QUEUE_\w+/) || [''])[0] }; }

// ตารางคิว 1 สัปดาห์ (หรือ days วัน) พร้อมรายชื่อ — สำหรับหน้าตารางคิว
function getRepairQueueWeek(fromYmd, days) {
  try {
    const rq = rq_();
    const g = rq.grid(rq.ymd(fromYmd) || rq.today(), Math.max(1, Math.min(31, Number(days) || 7)), true, null);
    g.success = true; g.today = rq.today();
    return g;
  } catch (e) { return rqFail_(e); }
}

// ช่องว่างล่วงหน้า (ไม่มีรายชื่อ) — สำหรับเลือกวันนัดตอนรับเรื่องซ่อม · service = ประเภทงาน (คิดชั่วโมงช่าง)
function getRepairQueueSlots(days, service) {
  try {
    const rq = rq_(), c = rq.cfg();
    const g = rq.grid(rq.today(), Math.max(1, Math.min(31, Number(days) || c.days_ahead)), false, null, { service: service || '' });
    g.success = true;
    return g;
  } catch (e) { return rqFail_(e); }
}

// พนักงานจองคิวให้ลูกค้า (โทรมา / นัดล่วงหน้า): สร้างงานซ่อมใน RepairJobs + คิวใน RepairQueue
// job = ข้อมูลเดียวกับ createRepairJob() + date, period, force (รับเกินจำนวน)
function bookRepairQueue(job, staffName) {
  try {
    if (!job || !job.customerName || !job.problem) return { success: false, message: 'กรุณากรอกชื่อลูกค้าและอาการ/ปัญหา' };
    let jobId = '';
    const r = rq_().book({
      date: job.date, period: job.period, name: job.customerName, phone: job.customerPhone || '', bike: job.bikeModel || '',
      service: job.service || '', source: 'พนักงาน POS', note: (staffName ? 'โดย ' + staffName + ' · ' : '') + (job.note || ''), force: !!job.force
    }, function () {
      const res = createRepairJob(job);
      if (!res.success) throw new Error(res.message);
      jobId = res.jobId;
      rqAddServiceLine_(res.jobId, job.service);
      return { job_id: res.jobId };
    }, null);
    return { success: true, jobId: jobId, queue: r.queue, message: 'จองคิว ' + r.queue.date + ' และรับเรื่องซ่อม ' + jobId + ' เรียบร้อย' };
  } catch (e) { return rqFail_(e); }
}

// รับรถตอนนี้ (Walk-in): สร้างงานซ่อมตามปกติ + บันทึกในตารางคิว (มาแล้ว) เพื่อคิดชั่วโมงช่างตามประเภทงาน
// และใส่ "วันนัดรับรถ" ให้อัตโนมัติถ้าพนักงานไม่ได้ใส่เอง
function checkinRepairNow(job, staffName) {
  try {
    if (!job || !job.customerName || !job.problem) return { success: false, message: 'กรุณากรอกชื่อลูกค้าและอาการ/ปัญหา' };
    const rq = rq_(), now = new Date();
    const period = (function () { const c = rq.cfg(), t = Utilities.formatDate(now, 'Asia/Vientiane', 'HH:mm'); for (const p of c.periods) if (t < p.end) return p.id; return c.periods[c.periods.length - 1].id; })();
    let jobId = '';
    const r = rq.book({
      date: rq.today(), period: period, name: job.customerName, phone: job.customerPhone || '', bike: job.bikeModel || '', service: job.service || '',
      source: 'หน้าร้าน (POS)', note: (staffName ? 'รับโดย ' + staffName : ''), arrived: true
    }, function () {
      const res = createRepairJob(job);
      if (!res.success) throw new Error(res.message);
      jobId = res.jobId;
      rqAddServiceLine_(res.jobId, job.service);
      return { job_id: res.jobId };
    }, null);
    return { success: true, jobId: jobId, queue: r.queue, message: 'รับเรื่องซ่อม ' + jobId + ' เรียบร้อย' };
  } catch (e) { return rqFail_(e); }
}

// ถ้ารับงานประเภทนี้ตอนนี้ จะพร้อมรับรถเมื่อไร (แสดงในหน้ารับเรื่องซ่อม)
function estimateRepair(service) {
  try { const e = rq_().estimate(service || '', '', '', null); e.success = true; return e; }
  catch (e) { return rqFail_(e); }
}

// รายการประเภทงาน + ชั่วโมงช่าง (สำหรับช่องเลือกประเภทงาน)
function getRepairQueueServices() {
  try { const c = rq_().cfg(); return { success: true, svc_hours: c.svc_hours, default_hours: c.default_hours, day_hours: c.day_hours }; }
  catch (e) { return rqFail_(e); }
}

// มาแล้ว / ไม่มา / ยกเลิก / ย้ายวัน-ช่วง / หมายเหตุ  — o = { id, status?, date?, period?, note?, force? }
function updateRepairQueue(o) {
  try { rq_().update(o || {}, null); return { success: true, message: 'บันทึกคิวเรียบร้อย' }; }
  catch (e) { return rqFail_(e); }
}

// ปิด/เปิด วัน หรือ ช่วง, จำนวนรับเฉพาะวัน — o = { date, period?, closed?, cap?, reason? }
function blockRepairQueue(o) {
  try { rq_().block(o || {}); return { success: true, message: 'บันทึกเรียบร้อย' }; }
  catch (e) { return rqFail_(e); }
}

// ตั้งค่าช่วงเวลา/จำนวนรับ — เฉพาะผู้จัดการ (ตรวจสิทธิ์ที่หน้าจอ)
function saveRepairQueueConfig(o) {
  try {
    const c = rq_().setConfig({ periods: o.periods, days_ahead: o.days_ahead, lead_min: o.lead_min, day_hours: o.day_hours, slack_days: o.slack_days,
                                default_hours: o.default_hours, off_days: o.off_days, svc_hours: o.svc_hours });
    return { success: true, config: c, message: 'บันทึกการตั้งค่าคิวเรียบร้อย' };
  }
  catch (e) { return rqFail_(e); }
}

// { JobID: { date, period, status, source } } — แสดงวันนัดบนการ์ดงานซ่อม
function getRepairQueueByJob() {
  try { return rq_().byJob(); } catch (e) { return {}; }
}

/* ══ Sevenday — ລະບົບຄິວສ້ອມ / คิวซ่อม (ໃຊ້ຮ່ວມກັນ: WebApiRouter ຂອງເວັບ ແລະ POS V2) ══════════════
   ຂໍ້ມູນທັງໝົດຢູ່ໃນໄຟລ໌ POS ໄຟລ໌ດຽວ:
     • RepairQueue        — ຄິວ 1 ແຖວ = 1 ຄັນ (QueueID, ວັນທີ, ຊ່ວງ, JobID, ລູກຄ້າ, … ສະຖານະຄິວ, ພ້ອມຮັບ)
     • RepairQueueConfig  — ຕັ້ງຄ່າ (JSON ໃນເຊວ A2: ຊ່ວງເວລາ, ຈຳນວນຮັບ, ວັນປິດ, ເວລາເປີດຮ້ານ, ຊົ່ວໂມງຊ່າງ)
     • RepairJobs         — ງານສ້ອມຂອງ POS (ອ່ານສະຖານະ + ຂຽນໝາຍເຫດ / ວັນນັດຮັບ)
   2 ຢ່າງທີ່ຖືກກວດກ່ອນຮັບຈອງ:
     1) ຮັບລົດເຂົ້າ: ແຕ່ລະຊ່ວງ (ເຊົ້າ/ບ່າຍ/ແລງ) ຮັບໄດ້ຈັກຄັນ
     2) ຊົ່ວໂມງຊ່າງ: ແຕ່ລະມື້ຊ່າງເຮັດວຽກໄດ້ day_hours ຊົ່ວໂມງ — ງານແຕ່ລະງານໃຊ້ຊົ່ວໂມງຕາມປະເພດ (Basic 1, Standard 3, Ultimate 16 …)
        ງານຖືກຈັດລຽງຕາມລຳດັບທີ່ຮັບ/ຈອງ ແລ້ວກິນຊົ່ວໂມງຊ່າງມື້ຕໍ່ມື້ (ຂ້າມວັນປິດ) → ໄດ້ວັນ-ເວລາ "ພ້ອມຮັບລົດ"
        ຮັບຈອງໄດ້ກໍ່ຕໍ່ເມື່ອ ງານໃໝ່ສຳເລັດພາຍໃນ (ມື້ທີ່ຕ້ອງໃຊ້ + slack_days) ມື້ເຮັດວຽກ
   ⚠️ ໂຄ້ດສ່ວນນີ້ຕ້ອງຄືກັນທັງ 2 ໂປຣເຈັກ — ແກ້ບ່ອນໜຶ່ງ ໃຫ້ຄັດລອກໄປອີກບ່ອນ */
function RepairQueueEngine_(ss) {
  var TZ = 'Asia/Vientiane', Q_SHEET = 'RepairQueue', CFG_SHEET = 'RepairQueueConfig', JOBS = 'RepairJobs';
  var HEAD = ['QueueID', 'วันที่นัด', 'ช่วงเวลา', 'JobID', 'ชื่อลูกค้า', 'เบอร์โทร', 'จักรยาน', 'บริการ', 'ที่มา', 'สถานะคิว', 'หมายเหตุ', 'สร้างเมื่อ', 'อัปเดต', 'พร้อมรับ (ประมาณ)'];
  var STATUS = ['ยืนยันแล้ว', 'มาแล้ว', 'ไม่มา', 'ยกเลิก'], USES = { 'ยืนยันแล้ว': 1, 'มาแล้ว': 1 };
  var JOB_DONE = /เสร็จแล้ว|รับรถคืนแล้ว|ยกเลิก|ຍົກເລີກ/, JOB_PAUSED = /รออะไหล่/;
  var DEF = { periods: [ { id: 'am', start: '09:00', end: '12:00', cap: 2 }, { id: 'pm', start: '13:00', end: '15:00', cap: 1 }, { id: 'ev', start: '15:00', end: '18:00', cap: 1 } ],
              days_ahead: 14, lead_min: 60, blocks: {}, hours: null,
              day_hours: 8, slack_days: 1, default_hours: 2, off_days: [6], svc_sku: {}, svc_hours: { 'Basic': 1, 'Standard': 3, 'Ultimate': 16, 'ซ่อมทั่วไป': 2 } };

  function hm(v) {
    if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
    v = String(v || '').trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '';
  }
  function mins(t) { var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function hhmm(m) { m = Math.round(m); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  function today() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
  function nowMin() { return mins(Utilities.formatDate(new Date(), TZ, 'HH:mm')); }
  function ymd(v) {
    if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    var s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }
  function addDays(d, n) { var x = new Date(d + 'T12:00:00+07:00'); x.setUTCDate(x.getUTCDate() + n); return Utilities.formatDate(x, TZ, 'yyyy-MM-dd'); }
  function dow(d) { return new Date(d + 'T12:00:00+07:00').getUTCDay(); }
  function intIn(v, lo, hi, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n)); }
  function numIn(v, lo, hi, dflt) { var n = parseFloat(v); return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, Math.round(n * 4) / 4)); }

  function qSheet() {
    var sh = ss.getSheetByName(Q_SHEET);
    if (!sh) { sh = ss.insertSheet(Q_SHEET); sh.appendRow(HEAD); sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold'); sh.setFrozenRows(1); }
    else if (!sh.getRange(1, HEAD.length).getValue()) sh.getRange(1, HEAD.length).setValue(HEAD[HEAD.length - 1]);   // ເພີ່ມຖັນ "ພ້ອມຮັບ" ໃຫ້ຊີດເກົ່າ
    return sh;
  }
  /* ── ຕັ້ງຄ່າ ── */
  function normPeriods(list) {
    return DEF.periods.map(function(d){
      var x = (list || []).filter(function(p){ return p && p.id === d.id; })[0] || d;
      var st = hm(x.start) || d.start, en = hm(x.end) || d.end;
      if (mins(st) >= mins(en)) throw new Error('ເວລາຊ່ວງ ' + d.id + ' ບໍ່ຖືກຕ້ອງ');
      return { id: d.id, start: st, end: en, cap: intIn(x.cap, 0, 20, d.cap) };
    });
  }
  function normSvc(o) {
    var out = {};
    Object.keys(o || {}).forEach(function(k){ var n = String(k).replace(/[<>]/g, '').trim().slice(0, 40); if (n) out[n] = numIn(o[k], 0.25, 200, 2); });
    return out;
  }
  function normSku(o) { var r = {}; Object.keys(o || {}).forEach(function(k){ var n = String(k).replace(/[<>]/g, '').trim().slice(0, 40), v = String(o[k] || '').trim().slice(0, 60); if (n && v) r[n] = v; }); return r; }
  function normOff(a) { var o = []; (a || []).forEach(function(x){ x = parseInt(x, 10); if (x >= 0 && x <= 6 && o.indexOf(x) < 0) o.push(x); }); return o.sort(); }
  function readRaw() {
    var sh = ss.getSheetByName(CFG_SHEET);
    if (sh && sh.getLastRow() >= 2) { try { return JSON.parse(String(sh.getRange(2, 1).getValue() || '{}')) || {}; } catch (e) {} }
    try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('QUEUE_CFG') || '{}') || {}; } catch (e) { return {}; }   // ຄ່າເກົ່າ (ກ່ອນມີຊີດ)
  }
  function cfg() {
    var c = readRaw(), out = JSON.parse(JSON.stringify(DEF));
    try { if (Array.isArray(c.periods) && c.periods.length) out.periods = normPeriods(c.periods); } catch (e) {}
    if (c.days_ahead !== undefined) out.days_ahead = intIn(c.days_ahead, 1, 60, 14);
    if (c.lead_min !== undefined) out.lead_min = intIn(c.lead_min, 0, 2880, 60);
    if (c.blocks && typeof c.blocks === 'object') out.blocks = c.blocks;
    if (Array.isArray(c.hours) && c.hours.length === 7) out.hours = c.hours;
    if (c.day_hours !== undefined) out.day_hours = numIn(c.day_hours, 1, 48, 8);
    if (c.slack_days !== undefined) out.slack_days = intIn(c.slack_days, 0, 14, 1);
    if (c.default_hours !== undefined) out.default_hours = numIn(c.default_hours, 0.25, 200, 2);
    if (Array.isArray(c.off_days)) out.off_days = normOff(c.off_days);
    if (c.svc_sku && typeof c.svc_sku === 'object') out.svc_sku = normSku(c.svc_sku);
    if (c.svc_hours && typeof c.svc_hours === 'object' && Object.keys(c.svc_hours).length) out.svc_hours = normSvc(c.svc_hours);
    return out;
  }
  function saveCfg(c) {
    var t = today(), b = {};
    Object.keys(c.blocks || {}).forEach(function(k){ if (k.slice(0, 10) >= t) b[k] = c.blocks[k]; });   // ລຶບວັນທີ່ຜ່ານໄປແລ້ວ
    c.blocks = b;
    var sh = ss.getSheetByName(CFG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(CFG_SHEET);
      sh.getRange(1, 1).setValue('ตั้งค่าคิวซ่อม (JSON) — แก้ผ่านหน้าแอดมินเว็บ หรือ POS → งานซ่อม → ตารางคิว เท่านั้น');
      try { sh.hideSheet(); } catch (e) {}
    }
    sh.getRange(2, 1).setValue(JSON.stringify({ periods: c.periods, days_ahead: c.days_ahead, lead_min: c.lead_min, blocks: c.blocks, hours: c.hours || null,
      day_hours: c.day_hours, slack_days: c.slack_days, default_hours: c.default_hours, off_days: c.off_days, svc_sku: c.svc_sku, svc_hours: c.svc_hours }));
    return c;
  }
  function publicCfg(c) {
    return { periods: c.periods, days_ahead: c.days_ahead, lead_min: c.lead_min, blocks: c.blocks, day_hours: c.day_hours, slack_days: c.slack_days,
             default_hours: c.default_hours, off_days: c.off_days, svc_sku: c.svc_sku, svc_hours: c.svc_hours };
  }
  // ຊົ່ວໂມງຊ່າງຂອງງານ: ຊື່ບໍລິການກົງກັບລາຍການ → ຄ່ານັ້ນ, ບໍ່ດັ່ງນັ້ນຫາຊື່ໃນຂໍ້ຄວາມ (ເຊັ່ນ "Service Ultimate") → ຄ່າເລີ່ມຕົ້ນ
  function svcHours(c, service, text) {
    var keys = Object.keys(c.svc_hours).sort(function(a, b){ return b.length - a.length; }), s = String(service || '').trim().toLowerCase();
    for (var i = 0; i < keys.length; i++) if (s && s === keys[i].toLowerCase()) return c.svc_hours[keys[i]];
    var t = (s + ' ' + String(text || '')).toLowerCase();
    for (var j = 0; j < keys.length; j++) if (t.indexOf(keys[j].toLowerCase()) >= 0) return c.svc_hours[keys[j]];
    return c.default_hours;
  }
  /* ── ອ່ານຂໍ້ມູນ ── */
  function rows() {
    var sh = qSheet(), last = sh.getLastRow();
    if (last < 2) return [];
    return sh.getRange(2, 1, last - 1, HEAD.length).getValues().map(function(r, i){
      return { row: i + 2, id: String(r[0]), date: ymd(r[1]), period: String(r[2]), job_id: String(r[3] || ''), name: String(r[4] || ''), phone: String(r[5] || ''),
               bike: String(r[6] || ''), service: String(r[7] || ''), source: String(r[8] || ''), status: String(r[9] || ''), note: String(r[10] || ''),
               created: r[11] instanceof Date ? r[11].getTime() : 0, ready_saved: String(r[13] || '') };
    }).filter(function(q){ return q.id && q.date; });
  }
  function periodOf(c, t) { var m = mins(t), P = c.periods; for (var i = 0; i < P.length; i++) if (m < mins(P[i].end)) return P[i].id; return P[P.length - 1].id; }
  // ງານໃນ POS: { JobID: {status, problem, created, ...} }
  function posJobs() {
    var map = {}, sh = ss.getSheetByName(JOBS);
    if (!sh || sh.getLastRow() < 2) return map;
    sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues().forEach(function(r, i){
      var id = String(r[0] || ''); if (!id) return;
      map[id] = { row: i + 2, id: id, created: r[1] instanceof Date ? r[1] : null, name: String(r[2] || ''), phone: String(r[3] || ''), bike: String(r[4] || ''),
                  problem: String(r[5] || ''), status: String(r[6] || ''), appt: r[11], web: /^RE-/.test(id) || String(r[15]) === 'website' };
    });
    return map;
  }
  /* ── ໂຄງສ້າງວັນ: ຊ່ວງ + ຊົ່ວໂມງຊ່າງຂອງແຕ່ລະຊ່ວງ ── */
  function dayFn(c, hours) {
    var H = Array.isArray(hours) && hours.length === 7 ? hours : c.hours, cache = {};
    var L = c.periods.reduce(function(a, p){ return a + (p.cap > 0 ? mins(p.end) - mins(p.start) : 0); }, 0) || 1;
    return function(d) {
      if (cache[d]) return cache[d];
      var w = dow(d), h = H ? (H[w] || {}) : { closed: false, open: '09:00', close: '18:00' };
      var open = hm(h.open) || '09:00', close = hm(h.close) || '18:00', db = c.blocks[d] || null, off = (c.off_days || []).indexOf(w) >= 0;   // ວັນຊ່າງພັກ
      var closed = !!(h.closed || off || (db && db.closed));
      var P = c.periods.map(function(p){
        var b = c.blocks[d + '|' + p.id] || null, cap = b && b.cap !== undefined && b.cap !== '' ? +b.cap : p.cap;
        var inHours = !h.closed && mins(p.start) >= mins(open) && mins(p.start) < mins(close);
        var end = mins(close) < mins(p.end) ? close : p.end, off = closed || !inHours || !!(b && b.closed);
        var work = off || p.cap <= 0 ? 0 : c.day_hours * (mins(end) - mins(p.start)) / L;     // ຊົ່ວໂມງຊ່າງໃນຊ່ວງນີ້
        return { id: p.id, start: p.start, end: end, cap: cap, off: off || cap <= 0, work: work, reason: b ? String(b.reason || '') : '' };
      });
      return (cache[d] = { date: d, dow: w, closed: closed, reason: db ? String(db.reason || '') : (off ? 'off' : h.closed ? 'hours' : ''), periods: P,
                           work: P.reduce(function(a, p){ return a + p.work; }, 0) });
    };
  }
  /* ── ຈັດຊົ່ວໂມງຊ່າງ: ງານລຽງຕາມລຳດັບທີ່ຮັບ/ຈອງ ກິນຊົ່ວໂມງວ່າງມື້ຕໍ່ມື້ ── */
  function allocate(day, used, job, commit) {
    var rem = job.hours, d = job.date, P0 = day(d).periods, pi = Math.max(0, P0.map(function(p){ return p.id; }).indexOf(job.period)), first = true;
    for (var n = 0; n < 240; n++) {
      var D = day(d);
      for (; pi < D.periods.length; pi++) {
        var p = D.periods[pi], key = d + '|' + p.id, u = used[key] || 0, len = mins(p.end) - mins(p.start);
        if (p.work <= 0 || len <= 0) { first = false; continue; }
        var startM = mins(p.start), avail = p.work - u;
        if (first && job.fromMin && job.fromMin > startM) {          // ຮັບລົດກາງຊ່ວງ → ໃຊ້ໄດ້ແຕ່ເວລາທີ່ເຫຼືອ
          var f = Math.max(0, (mins(p.end) - job.fromMin) / len); avail = Math.min(avail, p.work * f);
        }
        first = false;
        if (avail <= 1e-6) continue;
        var take = Math.min(avail, rem);
        if (commit) used[key] = u + take;
        rem -= take;
        if (rem <= 1e-6) {
          var at = startM + (u + take) / p.work * len;                // ເວລາສຳເລັດໂດຍປະມານໃນຊ່ວງນີ້
          return { date: d, period: p.id, time: hhmm(Math.ceil(Math.min(at, mins(p.end)) / 15) * 15) };
        }
      }
      d = addDays(d, 1); pi = 0;
    }
    return null;
  }
  // ລາຍການງານທີ່ກຳລັງໃຊ້ຊົ່ວໂມງຊ່າງ (ຄິວທີ່ຍັງບໍ່ສຳເລັດ + ງານໜ້າຮ້ານໃນ POS ທີ່ບໍ່ໄດ້ຜູກຄິວ)
  function workload(c, ALL, JOBMAP, exclude) {
    var t = today(), floor = addDays(t, -30), list = [], linked = {};
    ALL.forEach(function(q){ if (q.job_id) linked[q.job_id] = 1; });
    ALL.forEach(function(q){
      if (q.id === exclude || !USES[q.status] || q.date < floor) return;
      var j = JOBMAP[q.job_id];
      if (j && (JOB_DONE.test(j.status) || JOB_PAUSED.test(j.status))) return;
      list.push({ id: q.id, date: q.date, period: q.period, hours: svcHours(c, q.service, (j ? j.problem : '') + ' ' + q.note), order: q.created || new Date(q.date + 'T08:00:00+07:00').getTime() });
    });
    Object.keys(JOBMAP).forEach(function(id){
      var j = JOBMAP[id];
      if (linked[id] || j.web || !j.created || JOB_DONE.test(j.status) || JOB_PAUSED.test(j.status)) return;
      var d = Utilities.formatDate(j.created, TZ, 'yyyy-MM-dd'); if (d < floor) return;
      var tm = Utilities.formatDate(j.created, TZ, 'HH:mm');
      list.push({ id: 'POS-' + id, date: d, period: periodOf(c, tm), fromMin: mins(tm), hours: svcHours(c, '', j.problem), order: j.created.getTime() });
    });
    return list.sort(function(a, b){ return a.order - b.order; });
  }
  function plan(c, hours, ALL, JOBMAP, exclude) {
    var day = dayFn(c, hours), used = {}, done = {}, list = workload(c, ALL, JOBMAP, exclude);
    list.forEach(function(j){ done[j.id] = allocate(day, used, j, true); j.ready = done[j.id]; });
    return { day: day, used: used, ready: done, list: list };
  }
  // ງານໃໝ່ (ຊົ່ວໂມງ H) ສົ່ງລົດ d/period ສຳເລັດທັນກຳນົດບໍ? ກຳນົດ = ມື້ເຮັດວຽກທີ່ (ceil(H/day_hours) + slack_days) ນັບແຕ່ມື້ສົ່ງ
  function trial(c, PL, d, period, H, fromMin) {
    var r = allocate(PL.day, PL.used, { date: d, period: period, hours: H, fromMin: fromMin }, false);
    if (!r) return { ok: false, ready: null };
    var need = Math.max(1, Math.ceil(H / c.day_hours - 1e-9)) + c.slack_days, x = d, cnt = 0, deadline = d;
    for (var i = 0; i < 120 && cnt < need; i++) { if (PL.day(x).work > 0 || i === 0) { cnt++; deadline = x; } x = addDays(x, 1); }
    return { ok: r.date <= deadline, ready: r, deadline: deadline };
  }
  // ຕາຕະລາງ ວ່າງ/ບໍ່ວ່າງ: from (YYYY-MM-DD) ຈຳນວນ days ມື້ · hours = ເວລາເປີດຮ້ານ 7 ມື້ (0=ອາທິດ) · opt.service = ກວດຊົ່ວໂມງຊ່າງສຳລັບບໍລິການນີ້
  function grid(from, days, withEntries, hours, opt) {
    opt = opt || {};
    var c = cfg(), to = addDays(from, days - 1), ALL = rows(), JOBMAP = posJobs(), R = ALL.filter(function(q){ return q.date >= from && q.date <= to; });
    var linked = {}; ALL.forEach(function(q){ if (q.job_id) linked[q.job_id] = 1; });
    var PL = plan(c, hours, ALL, JOBMAP, opt.exclude), bikes = {}, walk = [];
    R.forEach(function(q){ if (USES[q.status]) bikes[q.date + '|' + q.period] = (bikes[q.date + '|' + q.period] || 0) + 1; });
    Object.keys(JOBMAP).forEach(function(id){                          // ງານໜ້າຮ້ານໃນ POS (ບໍ່ໄດ້ຈອງຄິວ) ນັບເປັນລົດເຂົ້າ
      var j = JOBMAP[id]; if (linked[id] || j.web || !j.created || /ยกเลิก|ຍົກເລີກ/.test(j.status)) return;
      var d = Utilities.formatDate(j.created, TZ, 'yyyy-MM-dd'); if (d < from || d > to) return;
      var tm = Utilities.formatDate(j.created, TZ, 'HH:mm'), p = periodOf(c, tm);
      bikes[d + '|' + p] = (bikes[d + '|' + p] || 0) + 1;
      walk.push({ id: 'POS-' + id, date: d, period: p, job_id: id, name: j.name, phone: j.phone, bike: j.bike, service: j.problem, source: 'POS', status: 'มาแล้ว', job_status: j.status, time: tm,
                  hours: svcHours(c, '', j.problem), ready: PL.ready['POS-' + id] || null });
    });
    var H = opt.service !== undefined && opt.service !== null && opt.service !== '' ? svcHours(c, opt.service, '') : 0;
    var nowD = today(), nowM = nowMin(), out = [];
    for (var i = 0; i < days; i++) {
      var d = addDays(from, i), D = PL.day(d), usedH = 0;
      var day = { date: d, dow: D.dow, closed: D.closed, reason: D.reason, periods: [] };
      D.periods.forEach(function(p){
        var u = bikes[d + '|' + p.id] || 0, st; usedH += PL.used[d + '|' + p.id] || 0;
        if (p.off) st = 'closed';
        else if (d < nowD || (d === nowD && nowM + c.lead_min >= mins(p.end))) st = 'past';
        else if (u >= p.cap) st = 'full';
        else st = 'open';
        var o = { id: p.id, start: p.start, end: p.end, cap: p.cap, used: u, left: Math.max(0, p.cap - u), status: st, reason: p.reason };
        if (H && st === 'open') {
          var tr = trial(c, PL, d, p.id, H, d === nowD ? Math.max(nowM, mins(p.start)) : 0);
          if (!tr.ok) o.status = 'busy';
          if (tr.ready) o.ready = tr.ready;
        }
        day.periods.push(o);
      });
      day.work = { cap: Math.round(D.work * 4) / 4, used: Math.round(usedH * 4) / 4, free: Math.max(0, Math.round((D.work - usedH) * 4) / 4) };
      out.push(day);
    }
    var res = { from: from, days: out, periods: c.periods.map(function(p){ return { id: p.id, start: p.start, end: p.end }; }), days_ahead: c.days_ahead,
                day_hours: c.day_hours, service_hours: H || undefined };
    if (withEntries) {
      res.entries = R.map(function(q){
        var j = JOBMAP[q.job_id];
        return { id: q.id, date: q.date, period: q.period, job_id: q.job_id, name: q.name, phone: q.phone, bike: q.bike, service: q.service, source: q.source,
                 status: q.status, note: q.note, job_status: j ? j.status : '', hours: svcHours(c, q.service, (j ? j.problem : '') + ' ' + q.note), ready: PL.ready[q.id] || null };
      }).concat(walk);
      res.config = publicCfg(c);
    }
    return res;
  }
  function slot(date, period, hours, opt) {
    var p = grid(date, 1, false, hours, opt).days[0].periods.filter(function(x){ return x.id === period; })[0];
    if (!p) throw new Error('ຊ່ວງເວລາບໍ່ຖືກຕ້ອງ');
    return p;
  }
  function readyText(r) { return r ? r.date + ' ' + r.time : ''; }
  function readyDate(r) { return r ? new Date(r.date + 'T' + r.time + ':00+07:00') : ''; }
  // ໃສ່ "ວັນທີນັດຮັບລົດ" ໃນ POS (ຖັນ 12) ຖ້າຍັງວ່າງ ຫຼື ຍັງເປັນຄ່າທີ່ລະບົບໃສ່ໃຫ້ກ່ອນໜ້າ
  function setJobReady(jobId, r, prevText) {
    if (!jobId || !r) return;
    try {
      var j = posJobs()[jobId]; if (!j) return;
      var cur = j.appt instanceof Date ? Utilities.formatDate(j.appt, TZ, 'yyyy-MM-dd HH:mm') : String(j.appt || '');
      if (cur && cur !== prevText) return;                             // ພະນັກງານຕັ້ງເອງ → ບໍ່ທັບ
      ss.getSheetByName(JOBS).getRange(j.row, 12).setValue(readyDate(r));
    } catch (e) { Logger.log('queue setJobReady: ' + e.message); }
  }
  function newId() { return 'Q-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + String(Date.now()).slice(-5) + Math.floor(Math.random() * 10); }
  /* ── ຈອງ: ກວດລົດເຂົ້າ + ຊົ່ວໂມງຊ່າງ (ຖ້າບໍ່ force) → ສ້າງງານສ້ອມດ້ວຍ makeJob() → ບັນທຶກຄິວ + ວັນພ້ອມຮັບ ──
     o = { date, period, service, name, phone, bike, source, note, force, arrived(ຮັບລົດແລ້ວ), fromMin } */
  function book(o, makeJob, hours) {
    var date = ymd(o.date), period = String(o.period || '');
    if (!date) throw new Error('date required');
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var c = cfg(), H = svcHours(c, o.service, o.note), p;
      if (o.arrived) p = { start: '', end: '' };
      else {
        p = slot(date, period, hours);
        if (!o.force && p.status !== 'open') throw new Error(p.status === 'full' ? 'QUEUE_FULL: ຊ່ວງເວລານີ້ເຕັມແລ້ວ — ກະລຸນາເລືອກເວລາອື່ນ' : 'QUEUE_CLOSED: ຊ່ວງເວລານີ້ບໍ່ຮັບຈອງ — ກະລຸນາເລືອກເວລາອື່ນ');
        var PL0 = plan(c, hours, rows(), posJobs()), tr = trial(c, PL0, date, period, H, date === today() ? Math.max(nowMin(), mins(p.start)) : 0);
        if (!o.force && !tr.ok) throw new Error('QUEUE_BUSY: ຊ່າງເຕັມ — ງານນີ້ໃຊ້ເວລາ ' + H + ' ຊົ່ວໂມງ ສຳເລັດບໍ່ທັນ. ກະລຸນາເລືອກມື້ອື່ນ');
      }
      var job = o.job_id ? { job_id: o.job_id } : makeJob();
      var id = newId(), now = new Date();
      qSheet().appendRow([id, "'" + date, period, job.job_id || '', o.name || '', "'" + String(o.phone || ''), o.bike || '', o.service || '', o.source || '',
                          o.arrived ? 'มาแล้ว' : 'ยืนยันแล้ว', String(o.note || '').slice(0, 300), now, now, '']);
      var PL = plan(c, hours, rows(), posJobs()), r = PL.ready[id] || null, sh = qSheet();
      if (r) { sh.getRange(sh.getLastRow(), 14).setValue("'" + readyText(r)); setJobReady(job.job_id, r, ''); }
      job.queue = { id: id, date: date, period: period, start: p.start, end: p.end, hours: H, ready: r };
      return job;
    } finally { lock.releaseLock(); }
  }
  // ປະມານການ: ຖ້າຮັບງານ (service) ຕອນນີ້ ຫຼື ວັນ/ຊ່ວງທີ່ເລືອກ ຈະພ້ອມຮັບເມື່ອໃດ
  function estimate(service, date, period, hours) {
    var c = cfg(), H = svcHours(c, service, ''), t = today(), d = ymd(date) || t;
    var pr = period || periodOf(c, hhmm(nowMin())), PL = plan(c, hours, rows(), posJobs());
    var tr = trial(c, PL, d, pr, H, d === t ? nowMin() : 0);
    return { hours: H, ready: tr.ready, ok: tr.ok, deadline: tr.deadline };
  }
  // ບັນທຶກໃນໝາຍເຫດຂອງງານໃນ POS (ບໍ່ປ່ຽນສະຖານະງານຂອງ POS)
  function jobNote(jobId, txt) {
    if (!jobId) return;
    try {
      var sh = ss.getSheetByName(JOBS); if (!sh || sh.getLastRow() < 2) return;
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === jobId) {
        var cell = sh.getRange(i + 2, 14), v = String(cell.getValue() || '');
        cell.setValue((v ? v + ' | ' : '') + '[' + Utilities.formatDate(new Date(), TZ, 'dd/MM HH:mm') + '] ' + txt); return;
      }
    } catch (e) { Logger.log('queue jobNote: ' + e.message); }
  }
  /* ── ແກ້ໄຂຄິວ: ຍ້າຍ / ສະຖານະ / ໝາຍເຫດ ── */
  function update(o, hours) {
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var q = rows().filter(function(x){ return x.id === String(o.id); })[0];
      if (!q) throw new Error('ບໍ່ພົບຄິວ ' + o.id);
      var sh = qSheet(), c = cfg();
      if (o.date || o.period) {
        var nd = ymd(o.date) || q.date, np = String(o.period || q.period);
        if (nd !== q.date || np !== q.period) {
          var p = slot(nd, np, hours, { exclude: q.id });
          if (!o.force && (p.status === 'closed' || p.used >= p.cap)) throw new Error('QUEUE_FULL: ຊ່ວງທີ່ຈະຍ້າຍໄປເຕັມ ຫຼື ປິດ');
          if (!o.force) {
            var PL0 = plan(c, hours, rows(), posJobs(), q.id), tr = trial(c, PL0, nd, np, svcHours(c, q.service, q.note), 0);
            if (!tr.ok) throw new Error('QUEUE_BUSY: ຊ່າງເຕັມ — ງານນີ້ສຳເລັດບໍ່ທັນໃນວັນທີ່ຈະຍ້າຍໄປ');
          }
          sh.getRange(q.row, 2, 1, 2).setValues([["'" + nd, np]]);
          jobNote(q.job_id, 'ย้ายคิว → ' + nd + ' ' + np);
        }
      }
      if (o.status) {
        if (STATUS.indexOf(o.status) < 0) throw new Error('status');
        sh.getRange(q.row, 10).setValue(o.status);
        if (o.status === 'ยกเลิก' || o.status === 'ไม่มา') jobNote(q.job_id, 'คิว: ' + o.status);
      }
      if (o.note !== undefined) sh.getRange(q.row, 11).setValue(String(o.note).slice(0, 300));
      sh.getRange(q.row, 13).setValue(new Date());
      if (o.date || o.period) {                                        // ຄຳນວນວັນພ້ອມຮັບໃໝ່
        var r = plan(c, hours, rows(), posJobs()).ready[q.id] || null;
        if (r) { sh.getRange(q.row, 14).setValue("'" + readyText(r)); setJobReady(q.job_id, r, q.ready_saved); }
      }
      return { ok: true };
    } finally { lock.releaseLock(); }
  }
  // ປິດ/ເປີດ ວັນ ຫຼື ຊ່ວງ, ຫຼື ປ່ຽນຈຳນວນຮັບສະເພາະວັນ
  function block(o) {
    var d = ymd(o.date); if (!d) throw new Error('date required');
    var key = o.period ? d + '|' + String(o.period) : d, c = cfg(), v = {};
    if (o.closed) v.closed = true;
    if (o.cap !== undefined && o.cap !== '' && o.cap !== null) v.cap = intIn(o.cap, 0, 20, 0);
    if (o.reason) v.reason = String(o.reason).replace(/[<>]/g, '').slice(0, 80);
    if (v.closed || v.cap !== undefined) c.blocks[key] = v; else delete c.blocks[key];
    saveCfg(c);
    return { ok: true, blocks: c.blocks };
  }
  function setConfig(o) {
    var c = cfg();
    if (Array.isArray(o.periods)) c.periods = normPeriods(o.periods);
    if (o.days_ahead !== undefined) c.days_ahead = intIn(o.days_ahead, 1, 60, 14);
    if (o.lead_min !== undefined) c.lead_min = intIn(o.lead_min, 0, 2880, 60);
    if (Array.isArray(o.hours) && o.hours.length === 7) c.hours = o.hours;
    if (o.day_hours !== undefined) c.day_hours = numIn(o.day_hours, 1, 48, 8);
    if (o.slack_days !== undefined) c.slack_days = intIn(o.slack_days, 0, 14, 1);
    if (o.default_hours !== undefined) c.default_hours = numIn(o.default_hours, 0.25, 200, 2);
    if (Array.isArray(o.off_days)) c.off_days = normOff(o.off_days);
    if (o.svc_sku && typeof o.svc_sku === 'object') c.svc_sku = normSku(o.svc_sku);
    if (o.svc_hours && typeof o.svc_hours === 'object') { var s = normSvc(o.svc_hours); if (Object.keys(s).length) c.svc_hours = s; }
    saveCfg(c);
    return publicCfg(c);
  }
  // ຄິວຂອງງານສ້ອມແຕ່ລະງານ (ໃຫ້ POS ສະແດງໃນບັດງານ)
  function byJob() {
    var m = {}; rows().forEach(function(q){ if (q.job_id && q.status !== 'ยกเลิก') m[q.job_id] = { id: q.id, date: q.date, period: q.period, status: q.status, source: q.source, ready: q.ready_saved }; });
    return m;
  }
  // ຊື່ແພັກເກດ (Basic / Standard …) → SKU ບໍລິການໃນ POS (ຕັ້ງໃນແອັດມິນເວັບ → ລາຄາ Service)
  function svcSku(service) { var m = cfg().svc_sku || {}, s = String(service || '').trim().toLowerCase(); for (var k in m) if (k.toLowerCase() === s) return m[k]; return ''; }
  return { svcSku: svcSku, cfg: cfg, saveCfg: saveCfg, grid: grid, slot: slot, book: book, estimate: estimate, update: update, block: block, setConfig: setConfig, byJob: byJob,
           svcHours: function(s, t){ return svcHours(cfg(), s, t); }, jobNote: jobNote, today: today, ymd: ymd, addDays: addDays, STATUS: STATUS };
}
