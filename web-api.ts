// @ts-nocheck
// Sevenday web-api — Supabase Edge Function (built from edge/web-api/build.mjs; comments stripped)
// 2026-10-31: BIB per category (each category starts at 01) + evt.renumberBibs
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { AwsClient } from "npm:aws4fetch@1.0.20";
const ENV = (k) => {
  try {
    if (typeof Deno !== "undefined") return Deno.env.get(k) || "";
  } catch (_) {
  }
  try {
    return globalThis.process && process.env[k] || "";
  } catch (_) {
    return "";
  }
};
const SB_URL = () => (ENV("SB_URL_OVERRIDE") || ENV("SUPABASE_URL") || "https://xukczixtojfmqhxepxwi.supabase.co").replace(/\/$/, "");
const PUBLISHABLE = "sb_publishable_TA0izlxOFihCICchC93c9A_jk4k4Bb6";
const TZ_OFF = 7 * 3600 * 1e3;
const R2 = () => ENV("R2_ENDPOINT") && ENV("R2_ACCESS_KEY_ID") && ENV("R2_SECRET_ACCESS_KEY") && ENV("R2_BUCKET") && ENV("R2_PUBLIC_URL") ? {
  endpoint: ENV("R2_ENDPOINT").trim().replace(/\/$/, ""),
  bucket: ENV("R2_BUCKET").trim(),
  pub: ENV("R2_PUBLIC_URL").trim().replace(/\/$/, ""),
  client: new AwsClient({ accessKeyId: ENV("R2_ACCESS_KEY_ID").trim(), secretAccessKey: ENV("R2_SECRET_ACCESS_KEY").trim(), service: "s3", region: "auto" })
} : null;
const WEB_SHEETS = { WebOrders: 1, WebMedia: 1, WebImages: 1, WebImagesPOS: 1, WebCategories: 1 };
const READ_RPC = /^web_(status|catalog|stock|customer_find|customer_orders|queue_data|evt_load)$/;
function norm(v) {
  if (v === null || v === void 0) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : new Date(v.getTime());
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.charAt(0) === "'") return v.slice(1);
    if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }
  return String(v);
}
const enc = (v) => v instanceof Date ? { $d: v.toISOString() } : v;
const dec = (v) => v && typeof v === "object" && v.$d ? new Date(v.$d) : v === null || v === void 0 ? "" : v;
const empty = (v) => v === "" || v === null || v === void 0;
const signed = (buf) => Array.from(buf, (b) => b > 127 ? b - 256 : b);
const toBuf = (x) => Array.isArray(x) ? Buffer.from(x.map((b) => b & 255)) : x instanceof Uint8Array ? Buffer.from(x) : Buffer.from(String(x), "utf8");
function fmtDate(d, tz, f) {
  const x = new Date(new Date(d).getTime() + TZ_OFF), p = (n) => String(n).padStart(2, "0");
  return f.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (t) => ({
    yyyy: x.getUTCFullYear(),
    yy: String(x.getUTCFullYear()).slice(-2),
    MM: p(x.getUTCMonth() + 1),
    dd: p(x.getUTCDate()),
    HH: p(x.getUTCHours()),
    mm: p(x.getUTCMinutes()),
    ss: p(x.getUTCSeconds())
  })[t]);
}
async function rpcRaw(fn, args) {
  const body = { p_key: ENV("WEB_API_KEY") };
  for (const a in args || {}) body[a] = args[a];
  let res, tries = 0;
  for (; ; ) {
    try {
      res = await fetch(SB_URL() + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: PUBLISHABLE, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status >= 500 && tries < 1 && READ_RPC.test(fn)) {
        tries++;
        continue;
      }
      break;
    } catch (e) {
      if (tries < 1 && READ_RPC.test(fn)) {
        tries++;
        continue;
      }
      throw new Error("ເຊື່ອມຕໍ່ຖານຂໍ້ມູນບໍ່ໄດ້ — ກະລຸນາລອງໃໝ່ (" + e.message + ")");
    }
  }
  const txt = await res.text();
  if (res.ok) return txt ? JSON.parse(txt) : null;
  let msg = txt;
  try {
    const j = JSON.parse(txt);
    msg = j.message || j.hint || j.details || txt;
  } catch (_) {
  }
  throw new Error(String(msg || "HTTP " + res.status));
}
async function makeCtx(need) {
  const sheets = [...new Set(need.sheets || [])];
  const [boot, catalog, queue] = await Promise.all([
    rpcRaw("web2_boot", { p_sheets: sheets }),
    need.catalog ? rpcRaw("web_catalog", {}) : null,
    need.queue ? rpcRaw("web_queue_data", { p_from: fmtDate(Date.now() - 60 * 864e5, "", "yyyy-MM-dd"), p_to: fmtDate(Date.now() + 120 * 864e5, "", "yyyy-MM-dd") }) : null
  ]);
  const rows = {};
  Object.keys(boot.rows || {}).forEach((name) => {
    const d = [];
    (boot.rows[name] || []).forEach((x) => {
      d[x[0] - 1] = (x[1] || []).map(dec);
    });
    for (let i = 0; i < d.length; i++) if (!d[i]) d[i] = [];
    rows[name] = d;
  });
  sheets.forEach((s) => {
    if (!rows[s]) rows[s] = [];
  });
  return {
    live: !!boot.live,
    evtLive: !!boot.evt_live,
    kv: boot.kv || {},
    rows,
    loaded: new Set(sheets),
    pre: { web_catalog: catalog, web_queue_data: queue },
    ops: [],
    kvOps: [],
    uploads: [],
    mails: [],
    later: [],
    logs: [],
    wrote: false
  };
}
async function commit(ctx, ok) {
  if (ok) {
    for (const u of ctx.uploads) {
      if (u.r2) {
        const c = R2();
        const r2 = await c.client.fetch(c.endpoint + "/" + c.bucket + "/" + u.path.split("/").map(encodeURIComponent).join("/"), {
          method: "PUT",
          headers: { "content-type": u.mime || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" },
          body: u.bytes
        });
        if (!r2.ok) throw new Error("ອັບໂຫລດຮູບຂຶ້ນ Cloudflare R2 ບໍ່ສຳເລັດ (" + r2.status + ")");
        continue;
      }
      const r = await fetch(SB_URL() + "/storage/v1/object/" + u.bucket + "/" + u.path, {
        method: "POST",
        headers: {
          authorization: "Bearer " + ENV("SUPABASE_SERVICE_ROLE_KEY"),
          apikey: ENV("SUPABASE_SERVICE_ROLE_KEY"),
          "content-type": u.mime || "application/octet-stream",
          "x-upsert": "false"
        },
        body: u.bytes
      });
      if (!r.ok) throw new Error("ອັບໂຫລດໄຟລ໌ບໍ່ສຳເລັດ (" + r.status + ")");
    }
  }
  const ops = ok ? ctx.ops : [];
  if (ops.length || ctx.kvOps.length) await rpcRaw("web2_flush", { p_ops: ops, p_kv: ctx.kvOps });
  if (!ok) return;
  await Promise.all(ctx.mails.map((m) => sendMail(m).catch((e) => console.log("mail error: " + e.message))));
  await Promise.all(ctx.later.map((f) => Promise.resolve().then(f).catch((e) => console.log("later: " + e.message))));
}
async function sendMail(m) {
  const key = ENV("RESEND_API_KEY");
  if (!key) {
    console.log("mail (ບໍ່ໄດ້ຕັ້ງ RESEND_API_KEY): " + m.subject);
    return;
  }
  const from = ENV("MAIL_FROM") || "Sevenday Bike <onboarding@resend.dev>";
  const r = await fetch(ENV("RESEND_URL") || "https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ from: m.name ? from.replace(/^[^<]*</, m.name + " <") : from, to: [m.to], subject: m.subject, text: m.body })
  });
  if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()).slice(0, 200));
}
function makeEnv(ctx) {
  function data(name) {
    if (!ctx.loaded.has(name)) throw new Error("PRELOAD_MISSING:sheet:" + name);
    return ctx.rows[name];
  }
  function lastRow(d) {
    for (let i = d.length - 1; i >= 0; i--) if ((d[i] || []).some((v) => !empty(v))) return i + 1;
    return 0;
  }
  function lastCol(d) {
    const n = lastRow(d);
    let c = 0;
    for (let i = 0; i < n; i++) {
      const r = d[i] || [];
      for (let j = r.length - 1; j >= c; j--) if (!empty(r[j])) {
        c = j + 1;
        break;
      }
    }
    return c;
  }
  class Range {
    constructor(sh, r, c, nr, nc) {
      Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 });
    }
    getValues() {
      const d = data(this.sh.name), out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = d[this.r - 1 + i] || [], o = [];
        for (let j = 0; j < this.nc; j++) {
          const v = row[this.c - 1 + j];
          o.push(v instanceof Date ? new Date(v.getTime()) : v === void 0 ? "" : v);
        }
        out.push(o);
      }
      return out;
    }
    getValue() {
      return this.getValues()[0][0];
    }
    setValues(grid) {
      const d = data(this.sh.name), g = grid.map((row) => row.map(norm));
      g.forEach((row, i) => {
        const R = d[this.r - 1 + i] || (d[this.r - 1 + i] = []);
        while (R.length < this.c - 1) R.push("");
        row.forEach((v, j) => {
          R[this.c - 1 + j] = v;
        });
      });
      for (let k = 0; k < d.length; k++) if (!d[k]) d[k] = [];
      ctx.ops.push({ op: "set", sheet: this.sh.name, row: this.r, col: this.c, values: g.map((row) => row.map(enc)) });
      return this;
    }
    setValue(v) {
      return this.setValues([[v]]);
    }
  }
  ["setFontWeight", "setBackground", "setFontColor", "setNumberFormat", "setDataValidation", "setHorizontalAlignment"].forEach((m) => {
    Range.prototype[m] = function() {
      return this;
    };
  });
  class Sheet {
    constructor(name, heads) {
      this.name = name;
      if (heads && heads.length && ctx.loaded.has(name) && lastRow(data(name)) === 0) this.getRange(1, 1, 1, heads.length).setValues([heads]);
    }
    getName() {
      return this.name;
    }
    getLastRow() {
      return lastRow(data(this.name));
    }
    getLastColumn() {
      return lastCol(data(this.name));
    }
    getRange(r, c, nr, nc) {
      return new Range(this, r, c, nr, nc);
    }
    getDataRange() {
      const d = data(this.name);
      return new Range(this, 1, 1, Math.max(1, lastRow(d)), Math.max(1, lastCol(d)));
    }
    appendRow(row) {
      const v = row.map(norm);
      if (!ctx.loaded.has(this.name)) {
        ctx.ops.push({ op: "append", sheet: this.name, row: null, col: 1, values: [v.map(enc)] });
        return this;
      }
      const d = data(this.name), r = lastRow(d) + 1;
      d[r - 1] = v.slice();
      ctx.ops.push({ op: "append", sheet: this.name, row: r, col: 1, values: [v.map(enc)] });
      return this;
    }
    deleteRow(r) {
      data(this.name).splice(r - 1, 1);
      ctx.ops.push({ op: "delete", sheet: this.name, row: r });
    }
    insertRowBefore(r) {
      data(this.name).splice(r - 1, 0, []);
      ctx.ops.push({ op: "insert", sheet: this.name, row: r });
      return this;
    }
  }
  ["setFrozenRows", "setColumnWidth", "setColumnWidths", "autoResizeColumns"].forEach((m) => {
    Sheet.prototype[m] = function() {
      return this;
    };
  });
  const sheetCache = {};
  const store = {
    sheet: (name, heads) => sheetCache[name] || (sheetCache[name] = new Sheet(name, heads)),
    flush() {
    },
    invalidate() {
    },
    pending: () => ctx.ops.length
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (WEB_SHEETS[name] || /^Event/.test(name)) return store.sheet(name);
      throw new Error("ຂໍ້ມູນ " + name + " ຍ້າຍໄປ Supabase ແລ້ວ (ບໍ່ໄດ້ໃຊ້ Google Sheets)");
    },
    insertSheet(name) {
      return store.sheet(name);
    },
    getSheets() {
      return [];
    },
    getName() {
      return "Supabase";
    }
  };
  const PROP_ENV = { SUPABASE_WEB_KEY: () => ENV("WEB_API_KEY"), GH_TOKEN: () => ENV("GH_TOKEN"), WEB_DATA_SOURCE: () => "supabase", EVT_DATA_SOURCE: () => null };
  const props = {
    getProperty(k) {
      if (PROP_ENV[k]) return PROP_ENV[k]();
      const v = ctx.kv["p:" + k];
      return v === void 0 || v === null ? null : String(v);
    },
    setProperty(k, v) {
      ctx.kv["p:" + k] = String(v);
      ctx.kvOps.push({ key: "p:" + k, value: String(v) });
      return this;
    },
    setProperties(o) {
      Object.keys(o).forEach((k) => this.setProperty(k, o[k]));
      return this;
    },
    deleteProperty(k) {
      delete ctx.kv["p:" + k];
      ctx.kvOps.push({ key: "p:" + k, value: null });
      return this;
    }
  };
  const PERSIST = /^(lf_|evf_|rl_)/;
  const mem = {};
  const cache = {
    get(k) {
      if (k in mem) return mem[k];
      const v = ctx.kv["c:" + k];
      return v === void 0 || v === null ? null : String(v);
    },
    put(k, v, ttl) {
      mem[k] = String(v);
      if (PERSIST.test(k)) ctx.kvOps.push({ key: "c:" + k, value: String(v), ttl: ttl || 600 });
    },
    getAll(ks) {
      const o = {};
      ks.forEach((k) => {
        const v = this.get(k);
        if (v !== null) o[k] = v;
      });
      return o;
    },
    putAll(o, ttl) {
      Object.keys(o).forEach((k) => this.put(k, o[k], ttl));
    },
    remove(k) {
      delete mem[k];
    },
    removeAll(ks) {
      ks.forEach((k) => delete mem[k]);
    }
  };
  const SLIP_FOLDERS = /slip/i;
  const publicUrl = (path) => SB_URL() + "/storage/v1/object/public/web-media/" + path.split("/").map(encodeURIComponent).join("/");
  function folder(name) {
    const priv = SLIP_FOLDERS.test(name), bucket = priv ? "event-slips" : "web-media";
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "files";
    return {
      setSharing() {
      },
      createFile(blob) {
        const fname = String(blob.getName() || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = slug + "/" + fmtDate(Date.now(), "", "yyyyMM") + "/" + randomUUID().slice(0, 8) + "-" + fname;
        const r2 = !priv && R2();
        ctx.uploads.push({ bucket, path, bytes: toBuf(blob.getBytes()), mime: blob.getContentType(), r2: !!r2 });
        const id = priv ? "sb:event-slips/" + path : (r2 ? "r2:" : "sb:web-media/") + path;
        const url = priv ? "" : r2 ? r2.pub + "/" + path.split("/").map(encodeURIComponent).join("/") : publicUrl(path);
        return { getId: () => id, setSharing() {
        }, getUrl: () => url, setTrashed() {
        } };
      }
    };
  }
  const DriveApp = {
    getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
    createFolder: folder,
    getFileById: () => ({ setTrashed() {
    } }),
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
    Permission: { VIEW: "VIEW" }
  };
  const Utilities = {
    DigestAlgorithm: { SHA_256: "sha256", MD5: "md5" },
    Charset: { UTF_8: "utf8" },
    computeDigest: (alg, s) => signed(createHash(alg).update(toBuf(s)).digest()),
    computeHmacSha256Signature: (v, k) => signed(createHmac("sha256", toBuf(k)).update(toBuf(v)).digest()),
    base64EncodeWebSafe: (x) => toBuf(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    base64Decode: (s) => signed(Buffer.from(String(s), "base64")),
    newBlob: (b, mime, name) => ({
      getDataAsString: () => toBuf(b).toString("utf8"),
      getBytes: () => Array.isArray(b) ? b : signed(toBuf(b)),
      getContentType: () => mime || "",
      getName: () => name || ""
    }),
    getUuid: () => randomUUID(),
    sleep() {
    },
    formatDate: fmtDate
  };
  return {
    store,
    publicUrl,
    SpreadsheetApp: { openById: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet, newDataValidation: () => {
      const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) };
      return b;
    } },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {
    }, hasLock: () => true, releaseLock() {
    } }) },
    Logger: { log: (m) => {
      ctx.logs.push(String(m));
      console.log(String(m));
    } },
    MailApp: { sendEmail: (to, subject, body, opt) => {
      ctx.mails.push({ to, subject, body, name: opt && opt.name });
    } },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() {
      return this;
    }, getContent() {
      return s;
    } }), MimeType: { JSON: "json" } },
    DriveApp,
    Utilities,
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {
    }, newTrigger: () => {
      throw new Error("ບໍ່ໃຊ້ trigger ແລ້ວ");
    } },
    SB_WEB_: {
      on: () => true,
      evtOn: () => ctx.evtLive,
      mode: () => "supabase",
      reset() {
      },
      hasKey: () => true,
      rpc(fn, args) {
        if (!/^web2?_[a-z_]+$/.test(fn)) throw new Error("bad rpc");
        if (fn in ctx.pre) {
          if (ctx.pre[fn] === null) throw new Error("PRELOAD_MISSING:" + fn);
          return ctx.pre[fn];
        }
        if (!READ_RPC.test(fn)) ctx.wrote = true;
        return rpcRaw(fn, args);
      }
    },
    later: (f) => ctx.later.push(f)
  };
}
const CAT_SHEETS = ["WebMedia", "WebImages", "WebImagesPOS", "WebCategories"];
const EVT_ALL = ["Events", "EventCategories", "EventParticipants", "EventRegistrations", "EventRegistrationItems", "EventPayments", "EventResults", "EventAuditLog"];
function needsFor(action) {
  if (/^evt\./.test(action)) return { sheets: EVT_ALL };
  const N = {
    getProducts: { catalog: 1, sheets: CAT_SHEETS },
    getProduct: { catalog: 1, sheets: CAT_SHEETS },
    exportCatalog: { catalog: 1, sheets: CAT_SHEETS },
    checkStock: { catalog: 1, sheets: CAT_SHEETS },
    getSettings: { catalog: 1 },
    getServices: { catalog: 1, sheets: CAT_SHEETS },
    getSiteConfig: { catalog: 1, sheets: CAT_SHEETS },
    createSale: { catalog: 1, sheets: CAT_SHEETS },
    getRepairSlots: { queue: 1 },
    createRepair: { queue: 1 },
    filmRequest: {},
    queueAdmin: { queue: 1 },
    queueSave: { queue: 1 },
    queueBlock: { queue: 1 },
    queueConfig: { queue: 1 },
    saveSiteConfig: { queue: 1 },
    adminList: { sheets: ["WebOrders"] },
    adminUpdate: { sheets: ["WebOrders"] },
    getCustomerOrders: { sheets: ["WebOrders"] },
    mediaList: { sheets: ["WebMedia"] },
    mediaSave: { sheets: ["WebMedia"] }
  };
  const n = N[action] || {};
  return { sheets: n.sheets || [], catalog: !!n.catalog, queue: !!n.queue };
}
const WEB_LIMITS = {
  createSale: [5, 3600, 60, 3600],
  createRepair: [5, 86400, 60, 3600],
  createBooking: [5, 86400, 40, 3600],
  filmRequest: [5, 86400, 40, 3600],
  registerCustomer: [3, 86400, 30, 3600],
  "evt.createRegistration": [10, 3600, 300, 3600],
  "evt.submitPayment": [10, 3600, 200, 3600]
};
function webClean(v, key) {
  if (typeof v === "string") {
    if (/image|base64|data_url|file/i.test(key)) return v;
    v = v.replace(/[<>]/g, "").slice(0, 3e3);
    if (/^[=@]/.test(v) || /^[+\-]\s*[A-Za-z(]/.test(v)) v = "'" + v;
    return v;
  }
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => webClean(x, key));
  if (v && typeof v === "object") {
    const o = {};
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = webClean(v[k], k);
    return o;
  }
  return v;
}
async function guard(action, body) {
  const lim = WEB_LIMITS[action];
  if (!lim) return true;
  const who = body.customer || body.participant || body;
  const key = String(who && who.phone || "").replace(/\D/g, "").slice(-8) || String(body.qr_token || body.email || "").slice(0, 60);
  const keys = [{ k: "rl_all_" + action, max: lim[2], sec: lim[3] }];
  if (key) keys.push({ k: "rl_" + action + "_" + key, max: lim[0], sec: lim[1] });
  return rpcRaw("web2_hit", { p_keys: keys });
}
function makeApp(ctx) {
  const __env = makeEnv(ctx);
  const { SpreadsheetApp, PropertiesService, CacheService, Logger, MailApp, ContentService, DriveApp, Utilities, ScriptApp, SB_WEB_ } = __env;
  const LockService = __env.LockService, __LockService = __env.LockService, EVT_STORE_ = __env.store, __later = __env.later;
  const UrlFetchApp = { fetch() {
    throw new Error("UrlFetchApp: ໃຊ້ fetch ແທນ");
  } };
  (function(root) {
    "use strict";
    var TZ_OFFSET_MIN = 7 * 60;
    var STATUS = ["ยืนยันแล้ว", "มาแล้ว", "ไม่มา", "ยกเลิก"], USES = { "ยืนยันแล้ว": 1, "มาแล้ว": 1 };
    var JOB_DONE = /เสร็จแล้ว|รับรถคืนแล้ว|ยกเลิก|ຍົກເລີກ/, JOB_PAUSED = /รออะไหล่/;
    var DEF = {
      periods: [{ id: "am", start: "09:00", end: "12:00", cap: 2 }, { id: "pm", start: "13:00", end: "15:00", cap: 1 }, { id: "ev", start: "15:00", end: "18:00", cap: 1 }],
      days_ahead: 14,
      lead_min: 60,
      blocks: {},
      hours: null,
      day_hours: 8,
      slack_days: 1,
      default_hours: 2,
      off_days: [6],
      svc_sku: {},
      svc_hours: { "Basic": 1, "Standard": 3, "Ultimate": 16, "ซ่อมทั่วไป": 2 }
    };
    function local(d) {
      return new Date((d instanceof Date ? d.getTime() : Number(d)) + TZ_OFFSET_MIN * 6e4);
    }
    function pad(n) {
      return ("0" + n).slice(-2);
    }
    function fmtYmd(d) {
      var x = local(d);
      return x.getUTCFullYear() + "-" + pad(x.getUTCMonth() + 1) + "-" + pad(x.getUTCDate());
    }
    function fmtHm(d) {
      var x = local(d);
      return pad(x.getUTCHours()) + ":" + pad(x.getUTCMinutes());
    }
    function hm(v) {
      v = String(v || "").trim();
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "";
    }
    function mins(t) {
      var p = String(t).split(":");
      return +p[0] * 60 + (+p[1] || 0);
    }
    function hhmm(m) {
      m = Math.round(m);
      return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
    }
    function today() {
      return fmtYmd(/* @__PURE__ */ new Date());
    }
    function nowMin() {
      return mins(fmtHm(/* @__PURE__ */ new Date()));
    }
    function ymd(v) {
      if (v instanceof Date) return fmtYmd(v);
      var s = String(v || "").trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
    }
    function addDays(d, n) {
      var x = /* @__PURE__ */ new Date(d + "T12:00:00+07:00");
      x.setUTCDate(x.getUTCDate() + n);
      return fmtYmd(x);
    }
    function dow(d) {
      return (/* @__PURE__ */ new Date(d + "T12:00:00+07:00")).getUTCDay();
    }
    function intIn(v, lo, hi, dflt) {
      var n = parseInt(v, 10);
      return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
    }
    function numIn(v, lo, hi, dflt) {
      var n = parseFloat(v);
      return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, Math.round(n * 4) / 4));
    }
    function normPeriods(list) {
      return DEF.periods.map(function(d) {
        var x = (list || []).filter(function(p) {
          return p && p.id === d.id;
        })[0] || d;
        var st = hm(x.start) || d.start, en = hm(x.end) || d.end;
        if (mins(st) >= mins(en)) throw new Error("เวลาช่วง " + d.id + " ไม่ถูกต้อง");
        return { id: d.id, start: st, end: en, cap: intIn(x.cap, 0, 20, d.cap) };
      });
    }
    function normSvc(o) {
      var out = {};
      Object.keys(o || {}).forEach(function(k) {
        var n = String(k).replace(/[<>]/g, "").trim().slice(0, 40);
        if (n) out[n] = numIn(o[k], 0.25, 200, 2);
      });
      return out;
    }
    function normSku(o) {
      var r = {};
      Object.keys(o || {}).forEach(function(k) {
        var n = String(k).replace(/[<>]/g, "").trim().slice(0, 40), v = String(o[k] || "").trim().slice(0, 60);
        if (n && v) r[n] = v;
      });
      return r;
    }
    function normOff(a) {
      var o = [];
      (a || []).forEach(function(x) {
        x = parseInt(x, 10);
        if (x >= 0 && x <= 6 && o.indexOf(x) < 0) o.push(x);
      });
      return o.sort();
    }
    function cfgFrom(c) {
      c = c || {};
      var out = JSON.parse(JSON.stringify(DEF));
      try {
        if (Array.isArray(c.periods) && c.periods.length) out.periods = normPeriods(c.periods);
      } catch (e) {
      }
      if (c.days_ahead !== void 0) out.days_ahead = intIn(c.days_ahead, 1, 60, 14);
      if (c.lead_min !== void 0) out.lead_min = intIn(c.lead_min, 0, 2880, 60);
      if (c.blocks && typeof c.blocks === "object") out.blocks = c.blocks;
      if (Array.isArray(c.hours) && c.hours.length === 7) out.hours = c.hours;
      if (c.day_hours !== void 0) out.day_hours = numIn(c.day_hours, 1, 48, 8);
      if (c.slack_days !== void 0) out.slack_days = intIn(c.slack_days, 0, 14, 1);
      if (c.default_hours !== void 0) out.default_hours = numIn(c.default_hours, 0.25, 200, 2);
      if (Array.isArray(c.off_days)) out.off_days = normOff(c.off_days);
      if (c.svc_sku && typeof c.svc_sku === "object") out.svc_sku = normSku(c.svc_sku);
      if (c.svc_hours && typeof c.svc_hours === "object" && Object.keys(c.svc_hours).length) out.svc_hours = normSvc(c.svc_hours);
      return out;
    }
    function publicCfg(c) {
      return {
        periods: c.periods,
        days_ahead: c.days_ahead,
        lead_min: c.lead_min,
        blocks: c.blocks,
        day_hours: c.day_hours,
        slack_days: c.slack_days,
        default_hours: c.default_hours,
        off_days: c.off_days,
        svc_sku: c.svc_sku,
        svc_hours: c.svc_hours
      };
    }
    function svcHours(c, service, text) {
      var keys = Object.keys(c.svc_hours).sort(function(a, b) {
        return b.length - a.length;
      }), s = String(service || "").trim().toLowerCase();
      for (var i = 0; i < keys.length; i++) if (s && s === keys[i].toLowerCase()) return c.svc_hours[keys[i]];
      var t = (s + " " + String(text || "")).toLowerCase();
      for (var j = 0; j < keys.length; j++) if (t.indexOf(keys[j].toLowerCase()) >= 0) return c.svc_hours[keys[j]];
      return c.default_hours;
    }
    function periodOf(c, t) {
      var m = mins(t), P = c.periods;
      for (var i = 0; i < P.length; i++) if (m < mins(P[i].end)) return P[i].id;
      return P[P.length - 1].id;
    }
    function Engine(data) {
      var C = cfgFrom(data && data.cfg);
      var ALL = (data && data.queue || []).map(function(q) {
        return {
          id: String(q.id),
          date: ymd(q.date),
          period: String(q.period),
          job_id: String(q.job_id || ""),
          name: q.name || "",
          phone: q.phone || "",
          bike: q.bike || "",
          service: q.service || "",
          source: q.source || "",
          status: q.status || "",
          note: q.note || "",
          created: Number(q.created) || 0,
          ready_saved: q.ready_saved || ""
        };
      }).filter(function(q) {
        return q.id && q.date;
      });
      var JOBMAP = {};
      (data && data.jobs || []).forEach(function(j) {
        JOBMAP[j.id] = {
          id: j.id,
          created: j.created ? new Date(Number(j.created)) : null,
          name: j.name || "",
          phone: j.phone || "",
          bike: j.bike || "",
          problem: j.problem || "",
          status: j.status || "",
          web: !!j.web
        };
      });
      function dayFn(c, hours) {
        var H = Array.isArray(hours) && hours.length === 7 ? hours : c.hours, cache = {};
        var L = c.periods.reduce(function(a, p) {
          return a + (p.cap > 0 ? mins(p.end) - mins(p.start) : 0);
        }, 0) || 1;
        return function(d) {
          if (cache[d]) return cache[d];
          var w = dow(d), h = H ? H[w] || {} : { closed: false, open: "09:00", close: "18:00" };
          var open = hm(h.open) || "09:00", close = hm(h.close) || "18:00", db = c.blocks[d] || null, off = (c.off_days || []).indexOf(w) >= 0;
          var closed = !!(h.closed || off || db && db.closed);
          var P = c.periods.map(function(p) {
            var b = c.blocks[d + "|" + p.id] || null, cap = b && b.cap !== void 0 && b.cap !== "" ? +b.cap : p.cap;
            var inHours = !h.closed && mins(p.start) >= mins(open) && mins(p.start) < mins(close);
            var end = mins(close) < mins(p.end) ? close : p.end, poff = closed || !inHours || !!(b && b.closed);
            var work = poff || p.cap <= 0 ? 0 : c.day_hours * (mins(end) - mins(p.start)) / L;
            return { id: p.id, start: p.start, end, cap, off: poff || cap <= 0, work, reason: b ? String(b.reason || "") : "" };
          });
          return cache[d] = {
            date: d,
            dow: w,
            closed,
            reason: db ? String(db.reason || "") : off ? "off" : h.closed ? "hours" : "",
            periods: P,
            work: P.reduce(function(a, p) {
              return a + p.work;
            }, 0)
          };
        };
      }
      function allocate(day, used, job, commit2) {
        var rem = job.hours, d = job.date, P0 = day(d).periods, pi = Math.max(0, P0.map(function(p2) {
          return p2.id;
        }).indexOf(job.period)), first = true;
        for (var n = 0; n < 240; n++) {
          var D = day(d);
          for (; pi < D.periods.length; pi++) {
            var p = D.periods[pi], key = d + "|" + p.id, u = used[key] || 0, len = mins(p.end) - mins(p.start);
            if (p.work <= 0 || len <= 0) {
              first = false;
              continue;
            }
            var startM = mins(p.start), avail = p.work - u;
            if (first && job.fromMin && job.fromMin > startM) {
              var f = Math.max(0, (mins(p.end) - job.fromMin) / len);
              avail = Math.min(avail, p.work * f);
            }
            first = false;
            if (avail <= 1e-6) continue;
            var take = Math.min(avail, rem);
            if (commit2) used[key] = u + take;
            rem -= take;
            if (rem <= 1e-6) {
              var at = startM + (u + take) / p.work * len;
              return { date: d, period: p.id, time: hhmm(Math.ceil(Math.min(at, mins(p.end)) / 15) * 15) };
            }
          }
          d = addDays(d, 1);
          pi = 0;
        }
        return null;
      }
      function workload(c, exclude) {
        var t = today(), floor = addDays(t, -30), list = [], linked = {};
        ALL.forEach(function(q) {
          if (q.job_id) linked[q.job_id] = 1;
        });
        ALL.forEach(function(q) {
          if (q.id === exclude || !USES[q.status] || q.date < floor) return;
          var j = JOBMAP[q.job_id];
          if (j && (JOB_DONE.test(j.status) || JOB_PAUSED.test(j.status))) return;
          list.push({ id: q.id, date: q.date, period: q.period, hours: svcHours(c, q.service, (j ? j.problem : "") + " " + q.note), order: q.created || (/* @__PURE__ */ new Date(q.date + "T08:00:00+07:00")).getTime() });
        });
        Object.keys(JOBMAP).forEach(function(id) {
          var j = JOBMAP[id];
          if (linked[id] || j.web || !j.created || JOB_DONE.test(j.status) || JOB_PAUSED.test(j.status)) return;
          var d = fmtYmd(j.created);
          if (d < floor) return;
          var tm = fmtHm(j.created);
          list.push({ id: "POS-" + id, date: d, period: periodOf(c, tm), fromMin: mins(tm), hours: svcHours(c, "", j.problem), order: j.created.getTime() });
        });
        return list.sort(function(a, b) {
          return a.order - b.order;
        });
      }
      function plan(c, hours, exclude) {
        var day = dayFn(c, hours), used = {}, done = {};
        workload(c, exclude).forEach(function(j) {
          done[j.id] = allocate(day, used, j, true);
        });
        return { day, used, ready: done };
      }
      function trial(c, PL, d, period, H, fromMin) {
        var r = allocate(PL.day, PL.used, { date: d, period, hours: H, fromMin }, false);
        if (!r) return { ok: false, ready: null };
        var need = Math.max(1, Math.ceil(H / c.day_hours - 1e-9)) + c.slack_days, x = d, cnt = 0, deadline = d;
        for (var i = 0; i < 120 && cnt < need; i++) {
          if (PL.day(x).work > 0 || i === 0) {
            cnt++;
            deadline = x;
          }
          x = addDays(x, 1);
        }
        return { ok: r.date <= deadline, ready: r, deadline };
      }
      function grid(from, days, withEntries, hours, opt) {
        opt = opt || {};
        var c = C, to = addDays(from, days - 1), R = ALL.filter(function(q) {
          return q.date >= from && q.date <= to;
        });
        var linked = {};
        ALL.forEach(function(q) {
          if (q.job_id) linked[q.job_id] = 1;
        });
        var PL = plan(c, hours, opt.exclude), bikes = {}, walk = [];
        R.forEach(function(q) {
          if (USES[q.status]) bikes[q.date + "|" + q.period] = (bikes[q.date + "|" + q.period] || 0) + 1;
        });
        Object.keys(JOBMAP).forEach(function(id) {
          var j = JOBMAP[id];
          if (linked[id] || j.web || !j.created || /ยกเลิก|ຍົກເລີກ/.test(j.status)) return;
          var d2 = fmtYmd(j.created);
          if (d2 < from || d2 > to) return;
          var tm = fmtHm(j.created), p = periodOf(c, tm);
          bikes[d2 + "|" + p] = (bikes[d2 + "|" + p] || 0) + 1;
          walk.push({
            id: "POS-" + id,
            date: d2,
            period: p,
            job_id: id,
            name: j.name,
            phone: j.phone,
            bike: j.bike,
            service: j.problem,
            source: "POS",
            status: "มาแล้ว",
            job_status: j.status,
            time: tm,
            hours: svcHours(c, "", j.problem),
            ready: PL.ready["POS-" + id] || null
          });
        });
        var H = opt.service !== void 0 && opt.service !== null && opt.service !== "" ? svcHours(c, opt.service, "") : 0;
        var nowD = today(), nowM = nowMin(), out = [];
        for (var i = 0; i < days; i++) {
          var d = addDays(from, i), D = PL.day(d), usedH = 0;
          var day = { date: d, dow: D.dow, closed: D.closed, reason: D.reason, periods: [] };
          D.periods.forEach(function(p) {
            var u = bikes[d + "|" + p.id] || 0, st;
            usedH += PL.used[d + "|" + p.id] || 0;
            if (p.off) st = "closed";
            else if (d < nowD || d === nowD && nowM + c.lead_min >= mins(p.end)) st = "past";
            else if (u >= p.cap) st = "full";
            else st = "open";
            var o = { id: p.id, start: p.start, end: p.end, cap: p.cap, used: u, left: Math.max(0, p.cap - u), status: st, reason: p.reason };
            if (H && st === "open") {
              var tr = trial(c, PL, d, p.id, H, d === nowD ? Math.max(nowM, mins(p.start)) : 0);
              if (!tr.ok) o.status = "busy";
              if (tr.ready) o.ready = tr.ready;
            }
            day.periods.push(o);
          });
          day.work = { cap: Math.round(D.work * 4) / 4, used: Math.round(usedH * 4) / 4, free: Math.max(0, Math.round((D.work - usedH) * 4) / 4) };
          out.push(day);
        }
        var res = {
          from,
          days: out,
          periods: c.periods.map(function(p) {
            return { id: p.id, start: p.start, end: p.end };
          }),
          days_ahead: c.days_ahead,
          day_hours: c.day_hours,
          service_hours: H || void 0
        };
        if (withEntries) {
          res.entries = R.map(function(q) {
            var j = JOBMAP[q.job_id];
            return {
              id: q.id,
              date: q.date,
              period: q.period,
              job_id: q.job_id,
              name: q.name,
              phone: q.phone,
              bike: q.bike,
              service: q.service,
              source: q.source,
              status: q.status,
              note: q.note,
              job_status: j ? j.status : "",
              hours: svcHours(c, q.service, (j ? j.problem : "") + " " + q.note),
              ready: PL.ready[q.id] || null
            };
          }).concat(walk);
          res.config = publicCfg(c);
        }
        return res;
      }
      function slot(date, period, opt) {
        var p = grid(date, 1, false, null, opt).days[0].periods.filter(function(x) {
          return x.id === period;
        })[0];
        if (!p) throw new Error("ช่วงเวลาไม่ถูกต้อง");
        return p;
      }
      function readyText(r) {
        return r ? r.date + " " + r.time : "";
      }
      function readyISO(r) {
        return r ? r.date + "T" + r.time + ":00+07:00" : "";
      }
      function checkBook(o) {
        var date = ymd(o.date), period = String(o.period || ""), H = svcHours(C, o.service, o.note);
        if (o.arrived) {
          var now = /* @__PURE__ */ new Date(), tm = fmtHm(now), d0 = today(), pr = periodOf(C, tm);
          var PLn = plan(C, null), rr = allocate(PLn.day, PLn.used, { date: d0, period: pr, hours: H, fromMin: mins(tm) }, false);
          return { date: d0, period: pr, cap: 99, hours: H, ready: rr };
        }
        if (!date) throw new Error("กรุณาเลือกวันที่");
        var p = slot(date, period);
        if (!o.force && p.status !== "open") throw new Error(p.status === "full" ? "ช่วงเวลานี้เต็มแล้ว — กรุณาเลือกเวลาอื่น" : "ช่วงเวลานี้ไม่รับจอง — กรุณาเลือกเวลาอื่น");
        var PL0 = plan(C, null), tr = trial(C, PL0, date, period, H, date === today() ? Math.max(nowMin(), mins(p.start)) : 0);
        if (!o.force && !tr.ok) throw new Error("ช่างเต็ม — งานนี้ใช้เวลา " + H + " ชั่วโมง เสร็จไม่ทัน กรุณาเลือกวันอื่น");
        return { date, period, cap: o.force ? 99 : p.cap, hours: H, ready: tr.ready, start: p.start, end: p.end };
      }
      function checkMove(o) {
        var q = ALL.filter(function(x) {
          return x.id === String(o.id);
        })[0];
        if (!q) throw new Error("ไม่พบคิว " + o.id);
        var nd = ymd(o.date) || q.date, np = String(o.period || q.period), cap = 99;
        if (nd !== q.date || np !== q.period) {
          var p = slot(nd, np, { exclude: q.id });
          if (!o.force && (p.status === "closed" || p.used >= p.cap)) throw new Error("ช่วงที่จะย้ายไปเต็ม หรือปิดรับ");
          if (!o.force) {
            var tr = trial(C, plan(C, null, q.id), nd, np, svcHours(C, q.service, q.note), 0);
            if (!tr.ok) throw new Error("ช่างเต็ม — งานนี้เสร็จไม่ทันในวันที่จะย้ายไป");
            cap = p.cap;
          }
        }
        var save = { date: q.date, period: q.period };
        q.date = nd;
        q.period = np;
        var r = plan(C, null).ready[q.id] || null;
        q.date = save.date;
        q.period = save.period;
        return { cap, ready: r, prevReady: q.ready_saved };
      }
      function estimate(service, date, period) {
        var H = svcHours(C, service, ""), t = today(), d = ymd(date) || t, pr = period || periodOf(C, hhmm(nowMin())), PL = plan(C, null);
        var tr = trial(C, PL, d, pr, H, d === t ? nowMin() : 0);
        return { hours: H, ready: tr.ready, ok: tr.ok, deadline: tr.deadline };
      }
      function byJob() {
        var m = {};
        ALL.forEach(function(q) {
          if (q.job_id && q.status !== "ยกเลิก") m[q.job_id] = { id: q.id, date: q.date, period: q.period, status: q.status, source: q.source, ready: q.ready_saved };
        });
        return m;
      }
      function svcSku(service) {
        var m = C.svc_sku || {}, s = String(service || "").trim().toLowerCase();
        for (var k in m) if (k.toLowerCase() === s) return m[k];
        return "";
      }
      function newConfig(o) {
        var c = JSON.parse(JSON.stringify(C));
        if (Array.isArray(o.periods)) c.periods = normPeriods(o.periods);
        if (o.days_ahead !== void 0) c.days_ahead = intIn(o.days_ahead, 1, 60, 14);
        if (o.lead_min !== void 0) c.lead_min = intIn(o.lead_min, 0, 2880, 60);
        if (Array.isArray(o.hours) && o.hours.length === 7) c.hours = o.hours;
        if (o.day_hours !== void 0) c.day_hours = numIn(o.day_hours, 1, 48, 8);
        if (o.slack_days !== void 0) c.slack_days = intIn(o.slack_days, 0, 14, 1);
        if (o.default_hours !== void 0) c.default_hours = numIn(o.default_hours, 0.25, 200, 2);
        if (Array.isArray(o.off_days)) c.off_days = normOff(o.off_days);
        if (o.svc_sku && typeof o.svc_sku === "object") c.svc_sku = normSku(o.svc_sku);
        if (o.svc_hours && typeof o.svc_hours === "object") {
          var s = normSvc(o.svc_hours);
          if (Object.keys(s).length) c.svc_hours = s;
        }
        return c;
      }
      function blockValue(o) {
        var v = {};
        if (o.closed) v.closed = true;
        if (o.cap !== void 0 && o.cap !== "" && o.cap !== null) v.cap = intIn(o.cap, 0, 20, 0);
        if (o.reason) v.reason = String(o.reason).replace(/[<>]/g, "").slice(0, 80);
        return v.closed || v.cap !== void 0 ? v : null;
      }
      return {
        cfg: function() {
          return C;
        },
        grid,
        checkBook,
        checkMove,
        estimate,
        byJob,
        svcSku,
        svcHours: function(s, t) {
          return svcHours(C, s, t);
        },
        newConfig,
        blockValue,
        publicCfg: function() {
          return publicCfg(C);
        },
        readyText,
        readyISO,
        today,
        ymd,
        addDays,
        STATUS
      };
    }
    root.SevendayQueue = { Engine, today, addDays, ymd };
  })(typeof window !== "undefined" ? window : globalThis);
  var _WEB_ = /* @__PURE__ */ function() {
    var SHEET_ID = "1dd-tdH6KwrXQOP7bSU9xBU982VsqbyR-CKwLm2AToho";
    var WEB_SECRET = "SDdMc3wNjJEevs60n2oMQeGnuI";
    var NOTIFY_EMAIL = "Lock.xayasing2021@gmail.com";
    function _notify(subject, lines) {
      try {
        MailApp.sendEmail(NOTIFY_EMAIL, "[Sevenday] " + subject, lines.join("\n"));
      } catch (e) {
        Logger.log("notify error: " + e.message);
      }
    }
    var SN = {
      PRODUCTS: "Products",
      VARIANTS: "ProductVariants",
      CUSTOMERS: "Customers",
      SALES: "Sales",
      BOOKINGS: "Bookings",
      REPAIR: "RepairJobs",
      SETTINGS: "Settings"
    };
    function _sheet(name) {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var s = ss.getSheetByName(name);
      if (!s) throw new Error("Sheet not found: " + name);
      return s;
    }
    function _rows(name) {
      var s = _sheet(name);
      var data = s.getDataRange().getValues();
      return { headers: data[0], rows: data.slice(1), sheet: s };
    }
    var _imgColCache = null;
    function _imgCol(headers) {
      if (_imgColCache !== null) return _imgColCache;
      for (var i = 0; i < headers.length; i++) {
        if (/รูป|ຮູບ|image|photo|img/i.test(String(headers[i]))) {
          _imgColCache = i;
          return i;
        }
      }
      _imgColCache = 11;
      return 11;
    }
    function _imgUrl(v) {
      if (v === null || v === void 0) return "";
      if (typeof v === "object") {
        try {
          return v.getContentUrl ? v.getContentUrl() || "" : "";
        } catch (e) {
          return "";
        }
      }
      var s = String(v).trim();
      if (!s) return "";
      var m = s.match(/=IMAGE\(\s*"([^"]+)"/i);
      if (m) s = m[1];
      if (/^data:image\//.test(s)) return s;
      var id = (s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) || [])[1];
      if (!id && /^[a-zA-Z0-9_-]{25,}$/.test(s)) id = s;
      if (id) return "https://lh3.googleusercontent.com/d/" + id + "=w800";
      if (/^https?:\/\//.test(s)) return s;
      return "";
    }
    var _hideColCache = null;
    function _hideCol(headers) {
      if (_hideColCache !== null) return _hideColCache;
      _hideColCache = -1;
      for (var i = 0; i < headers.length; i++) {
        if (/ซ่อน|ຊ່ອນ|hide|หน้าร้าน|ໜ້າຮ້ານ/i.test(String(headers[i]))) {
          _hideColCache = i;
          break;
        }
      }
      return _hideColCache;
    }
    function _isHidden(row, HC) {
      if (HC < 0) return false;
      var v = row[HC];
      if (v === true) return true;
      return /^(true|yes|y|1|ใช่|ซ่อน|ແມ່ນ|ຊ່ອນ|x|✓)$/i.test(String(v).trim());
    }
    var IMG_SHEET = "WebImages";
    var IMG_FOLDER = "Sevenday Web Images";
    var _imgMap = null;
    function _webImgMap() {
      if (_imgMap) return _imgMap;
      _imgMap = {};
      var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(IMG_SHEET);
      if (!sh || sh.getLastRow() < 2) return _imgMap;
      sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r) {
        if (r[0]) _imgMap[String(r[0])] = { hash: String(r[1]), id: String(r[2]) };
      });
      return _imgMap;
    }
    function _webImg(sku, v) {
      var s = v && typeof v !== "object" ? String(v) : "";
      if (/^data:image\//.test(s)) {
        var c = _webImgMap()[String(sku)];
        return c && c.id ? "https://lh3.googleusercontent.com/d/" + c.id + "=w800" : "";
      }
      return _imgUrl(v);
    }
    function _md5(str) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str).map(function(b) {
        return ("0" + (b & 255).toString(16)).slice(-2);
      }).join("");
    }
    function syncImages() {
      var t0 = Date.now();
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var sh = ss.getSheetByName(IMG_SHEET);
      if (!sh) {
        sh = ss.insertSheet(IMG_SHEET);
        sh.appendRow(["SKU", "Hash", "FileID", "Updated"]);
      }
      var it = DriveApp.getFoldersByName(IMG_FOLDER);
      var folder = it.hasNext() ? it.next() : DriveApp.createFolder(IMG_FOLDER);
      try {
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {
      }
      var P = _rows(SN.PRODUCTS), IC = _imgCol(P.headers);
      var map = {}, rowOf = {};
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r, i2) {
        map[String(r[0])] = { hash: String(r[1]), id: String(r[2]) };
        rowOf[String(r[0])] = i2 + 2;
      });
      var done = 0, skipped = 0, failed = 0, left = 0;
      for (var i = 0; i < P.rows.length; i++) {
        var sku = String(P.rows[i][0] || ""), v = P.rows[i][IC];
        if (!sku || typeof v !== "string" || v.indexOf("data:image/") !== 0) continue;
        var h = _md5(v);
        if (map[sku] && map[sku].hash === h) {
          skipped++;
          continue;
        }
        if (Date.now() - t0 > 27e4) {
          left++;
          continue;
        }
        try {
          var m = v.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
          var ext = m[1].split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
          var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], sku.replace(/[\/\\]/g, "_") + "." + ext);
          var f = folder.createFile(blob);
          f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          if (map[sku] && map[sku].id) {
            try {
              DriveApp.getFileById(map[sku].id).setTrashed(true);
            } catch (e) {
            }
          }
          var rowVals = [[sku, h, f.getId(), /* @__PURE__ */ new Date()]];
          if (rowOf[sku]) sh.getRange(rowOf[sku], 1, 1, 4).setValues(rowVals);
          else {
            sh.appendRow(rowVals[0]);
            rowOf[sku] = sh.getLastRow();
          }
          map[sku] = { hash: h, id: f.getId() };
          done++;
        } catch (e) {
          failed++;
          Logger.log("ຮູບ " + sku + " ຜິດພາດ: " + e.message);
        }
      }
      var msg = "ແປງຮູບໃໝ່: " + done + " | ບໍ່ປ່ຽນແປງ: " + skipped + " | ຜິດພາດ: " + failed + (left ? " | ຍັງເຫຼືອ: " + left + " (ກົດ Run ອີກຄັ້ງ)" : "");
      if (!SB_WEB_.on()) {
        try {
          msg += " | " + _snapshotPosImages(P, IC);
        } catch (e) {
          Logger.log("snapshot: " + e.message);
        }
      }
      if (done) {
        clearProductCache();
        _ghKick();
      }
      Logger.log(msg);
      return msg;
    }
    var POSIMG_SHEET = "WebImagesPOS", _posImg = null;
    function _snapshotPosImages(P, IC) {
      P = P || _rows(SN.PRODUCTS);
      IC = IC === void 0 ? _imgCol(P.headers) : IC;
      _imgMap = null;
      var out = [];
      P.rows.forEach(function(r) {
        var sku = String(r[0] || "").trim();
        if (!sku) return;
        var u = _webImg(sku, r[IC]);
        if (u && !/^data:/.test(u)) out.push([sku, u]);
      });
      var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName(POSIMG_SHEET);
      if (!sh) sh = ss.insertSheet(POSIMG_SHEET);
      var keep = sh.getLastRow();
      sh.getRange(1, 1, 1, 2).setValues([["SKU", "URL"]]);
      if (out.length) sh.getRange(2, 1, out.length, 2).setValues(out);
      if (keep > out.length + 1) sh.getRange(out.length + 2, 1, keep - out.length - 1, 2).setValues(Array.apply(null, Array(keep - out.length - 1)).map(function() {
        return ["", ""];
      }));
      _posImg = null;
      return "ສຳເນົາຮູບ POS: " + out.length + " SKU";
    }
    function _posImgMap() {
      if (_posImg) return _posImg;
      _posImg = {};
      var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(POSIMG_SHEET);
      if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function(r) {
        if (r[0] && r[1]) _posImg[String(r[0])] = String(r[1]);
      });
      return _posImg;
    }
    var CAT_SHEET = "WebCategories";
    var SUBS = [
      ["mtb", "bikes", "ຈັກຍານ › ພູເຂົາ"],
      ["road", "bikes", "ຈັກຍານ › ເສືອໝອບ"],
      ["city", "bikes", "ຈັກຍານ › ທົ່ວໄປ / City"],
      ["kids", "bikes", "ຈັກຍານ › ເດັກ"],
      ["ebike", "bikes", "ຈັກຍານ › ໄຟຟ້າ"],
      ["used", "used", "ຈັກຍານ › ມືສອງ"],
      ["drivetrain", "parts", "ອາໄຫຼ່ › ລະບົບຂັບ & ເກຍ"],
      ["brake", "parts", "ອາໄຫຼ່ › ເບຣກ"],
      ["wheel", "parts", "ອາໄຫຼ່ › ລໍ້ & ຢາງ"],
      ["cockpit", "parts", "ອາໄຫຼ່ › ແຮນ ເບາະ ບັນໄດ"],
      ["frame", "parts", "ອາໄຫຼ່ › ເຟຣມ & ໂຊັກ"],
      ["parts-other", "parts", "ອາໄຫຼ່ › ອື່ນໆ"],
      ["lights", "accessories", "ອຸປະກອນ › ໄຟ"],
      ["locks", "accessories", "ອຸປະກອນ › ກະແຈລັອກ"],
      ["tools", "accessories", "ອຸປະກອນ › ສູບລົມ ເຄື່ອງມື ນ້ຳມັນ"],
      ["travel", "accessories", "ອຸປະກອນ › ກະເປົາ ກະຕິກ ຂາຈັບ"],
      ["acc-other", "accessories", "ອຸປະກອນ › ອື່ນໆ"],
      ["helmet", "gear", "ເຄື່ອງນຸ່ງ › ໝວກກັນກະທົບ"],
      ["apparel", "gear", "ເຄື່ອງນຸ່ງ › ເສື້ອ ຖົງມື ເກີບ"],
      ["camping", "outdoor", "Outdoor/Lifestyle › ແຄມປິ້ງ & ເດີນປ່າ"],
      ["lifestyle-wear", "outdoor", "Outdoor/Lifestyle › ເສື້ອຜ້າ Lifestyle"],
      ["lifestyle-gear", "outdoor", "Outdoor/Lifestyle › ກະເປົາ ແກ້ວ & ຂອງໃຊ້"],
      ["outdoor-other", "outdoor", "Outdoor/Lifestyle › ອື່ນໆ"],
      ["service", "service", "ບໍລິການ (ບໍ່ຂຶ້ນເວັບ)"]
    ];
    function _label2sub(label) {
      for (var i = 0; i < SUBS.length; i++) if (SUBS[i][2] === String(label).trim() || SUBS[i][0] === String(label).trim()) return SUBS[i];
      return null;
    }
    function _guessSub(cat, type) {
      var c = String(cat || "").toLowerCase(), t = String(type || "");
      var R = [
        [/บริการ|ບໍລິການ|^ค่า|^ຄ່າ|service|ค่าแรง|ຄ່າແຮງ/, "service"],
        [/มือสอง|ມືສອງ|used|second/, "used"],
        [/ไฟฟ้า|ໄຟຟ້າ|e-?bike|electric/, "ebike"],
        [/ภูเขา|ພູເຂົາ|mtb|mountain|เสือภูเขา/, "mtb"],
        [/หมอบ|ໝອບ|road|ถนน|ຖະໜົນ|gravel/, "road"],
        [/เด็ก|ເດັກ|kid|balance/, "kids"],
        [/หมวก|ໝວກ|helmet/, "helmet"],
        [/เสื้อ|ເສື້ອ|กางเกง|ໂສ້ງ|ถุงมือ|ຖົງມື|รองเท้า|ເກີບ|แว่น|ແວ່ນ|glove|jersey|shoe|apparel/, "apparel"],
        [/โซ่|ໂສ້|chain|เฟือง|ເຟືອງ|cassette|sprocket|ตีนผี|ຕີນຜີ|derail|สายเกียร์|ສາຍເກຍ|จาน|ຈານ|crank|เกียร์|ເກຍ|shifter|กะโหลก|ກະໂຫຼກ|bb/, "drivetrain"],
        [/เบรก|เบรค|ເບຣກ|brake|ผ้าเบรก|ຜ້າເບຣກ|ดิส|disc/, "brake"],
        [/ยาง|ຢາງ|ล้อ|ລໍ້|ขอบ|ຂອບ|ซี่|ຊີ່|ดุม|ດຸມ|tyre|tire|tube|wheel|rim|hub/, "wheel"],
        [/แฮนด์|แฮน|ແຮນ|คอ|ຄໍ|เบาะ|ເບາະ|อาน|บันได|ບັນໄດ|pedal|saddle|grip|ปลอก|ປອກ|stem|seatpost|หลักอาน/, "cockpit"],
        [/เฟรม|ເຟຣມ|โช้ค|โช๊ค|ໂຊັກ|fork|frame/, "frame"],
        [/ไฟ|ໄຟ|light|lamp/, "lights"],
        [/ล็อค|ล็อก|ລັອກ|lock|กุญแจ|ກະແຈ/, "locks"],
        [/สูบ|ສູບ|pump|เครื่องมือ|ເຄື່ອງມື|tool|น้ำมัน|ນ້ຳມັນ|lube|ล้าง|ລ້າງ|จารบี|ຈາລະບີ|grease|ประแจ/, "tools"],
        [/กระเป๋า|ກະເປົາ|กระติก|ກະຕິກ|ขาจับ|ຂາຈັບ|ไมล์|ໄມລ໌|bag|bottle|holder|computer|ตะแกรง|rack/, "travel"],
        [/อะไหล่|ອາໄຫຼ່|part/, "parts-other"],
        [/จักรยาน|ຈັກຍານ|รถถีบ|ລົດຖີບ|bike|bicycle/, "city"]
      ];
      if (/บริการ|ບໍລິການ/.test(t)) return "service";
      var CAMP = /แคมป์|แคมปิ้ง|ແຄມ|camp|เต็นท์|ເຕັນ|tent|เดินป่า|ເດີນປ່າ|hiking|เก้าอี้สนาม|ໂຕະພັບ|เตาแก๊ส|stove|ถุงนอน|sleeping/;
      if (/outdoor|lifestyle|ไลฟ์สไตล์|ໄລຟ໌ສະໄຕລ໌|กลางแจ้ง|ກາງແຈ້ງ/.test(c) || CAMP.test(c)) {
        if (CAMP.test(c)) return "camping";
        if (/เสื้อ|ເສື້ອ|กางเกง|ໂສ້ງ|หมวก|ໝວກ|cap|shirt|tee|wear|apparel|รองเท้า|ເກີບ|shoe/.test(c)) return "lifestyle-wear";
        if (/กระเป๋า|ກະເປົາ|เป้|ເປ້|bag|แก้ว|ແກ້ວ|กระติก|ກະຕິກ|tumbler|bottle|mug|ของใช้|ຂອງໃຊ້/.test(c)) return "lifestyle-gear";
        return "outdoor-other";
      }
      for (var i = 0; i < R.length; i++) if (R[i][0].test(c)) return R[i][1];
      return "acc-other";
    }
    var _catMap = null;
    function _catMapGet() {
      if (_catMap) return _catMap;
      _catMap = {};
      var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(CAT_SHEET);
      if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r) {
        var sub = _label2sub(r[2]);
        if (r[0] && sub) _catMap[String(r[0]).trim()] = sub[0];
      });
      return _catMap;
    }
    function _subOf(cat, type) {
      var code = _catMapGet()[String(cat || "").trim()] || _guessSub(cat, type);
      var sub = _label2sub(code) || _label2sub("acc-other");
      return { sub: sub[0], group: sub[1] };
    }
    function syncCategories() {
      var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName(CAT_SHEET);
      if (!sh) {
        sh = ss.insertSheet(CAT_SHEET);
        sh.getRange(1, 1, 1, 4).setValues([["ໝວດໃນ POS (ຖັນ C)", "ຈຳນວນສິນຄ້າ", "ກຸ່ມເທິງເວັບ (ແກ້ໄດ້)", "ໝາຍເຫດ"]]).setFontWeight("bold");
        sh.setFrozenRows(1);
        sh.setColumnWidth(1, 220);
        sh.setColumnWidth(3, 280);
        sh.setColumnWidth(4, 220);
      }
      var P = SB_WEB_.on() ? { rows: _sbCat().products.map(function(p) {
        var r = [];
        r[0] = p.sku;
        r[1] = p.name;
        r[2] = p.category;
        r[8] = p.type;
        return r;
      }) } : _rows(SN.PRODUCTS), count = {}, typeOf = {};
      P.rows.forEach(function(r) {
        var c = String(r[2] || "").trim();
        if (!r[0] || !c) return;
        count[c] = (count[c] || 0) + 1;
        typeOf[c] = r[8];
      });
      var existing = {}, last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function(r, i) {
        existing[String(r[0]).trim()] = i + 2;
      });
      var added = 0;
      Object.keys(count).sort().forEach(function(c) {
        if (existing[c]) {
          sh.getRange(existing[c], 2).setValue(count[c]);
          return;
        }
        var g = _label2sub(_guessSub(c, typeOf[c]));
        sh.appendRow([c, count[c], g[2], "ລະບົບເດົາໃຫ້ — ກວດ ແລະ ແກ້ໄດ້"]);
        added++;
      });
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(SUBS.map(function(x) {
        return x[2];
      }), true).setAllowInvalid(false).build();
      if (sh.getLastRow() > 1) sh.getRange(2, 3, sh.getLastRow() - 1, 1).setDataValidation(rule);
      _catMap = null;
      if (added) clearProductCache();
      return "ໝວດທັງໝົດ: " + Object.keys(count).length + " | ເພີ່ມໃໝ່: " + added;
    }
    var INBOX = "WebOrders";
    var INBOX_HEAD = ["ID", "ປະເພດ", "ວັນທີ", "ຊື່", "ເບີໂທ", "ອີເມວ", "ລາຍລະອຽດ", "ຍອດ (THB)", "ການຊຳລະ", "ການຮັບສິນຄ້າ", "ໝາຍເຫດລູກຄ້າ", "ສະຖານະ", "ອັບເດດ", "ໝາຍເຫດແອັດມິນ"];
    function _inbox() {
      var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName(INBOX);
      if (!sh) {
        sh = ss.insertSheet(INBOX);
        sh.appendRow(INBOX_HEAD);
        sh.getRange(1, 1, 1, INBOX_HEAD.length).setFontWeight("bold");
        sh.setFrozenRows(1);
      }
      return sh;
    }
    function _inboxAdd(o) {
      try {
        _inbox().appendRow([
          o.id,
          o.type,
          /* @__PURE__ */ new Date(),
          o.name || "",
          String(o.phone || ""),
          o.email || "",
          o.details || "",
          o.total || 0,
          o.payment || "",
          o.delivery || "",
          o.notes || "",
          "ໃໝ່",
          /* @__PURE__ */ new Date(),
          ""
        ]);
      } catch (e) {
        Logger.log("inbox error: " + e.message);
      }
    }
    function _inboxStatusMap() {
      var m = {};
      try {
        var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(INBOX);
        if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues().forEach(function(r) {
          m[String(r[0])] = String(r[11]);
        });
      } catch (e) {
      }
      return m;
    }
    function _adminToken() {
      var exp = Date.now() + 12 * 3600 * 1e3, payload = "ADMIN|" + exp;
      return Utilities.base64EncodeWebSafe(payload) + "." + Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _sessionKey()));
    }
    function _isAdmin(token) {
      try {
        var t = String(token || "").split(".");
        var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(t[0])).getDataAsString();
        return payload.indexOf("ADMIN|") === 0 && Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _sessionKey())) === t[1] && Date.now() < Number(payload.split("|")[1]);
      } catch (e) {
        return false;
      }
    }
    function adminLogin(body) {
      var stored = PropertiesService.getScriptProperties().getProperty("ADMIN_PW");
      if (!stored) return { ok: false, error: "ຍັງບໍ່ໄດ້ຕັ້ງລະຫັດແອັດມິນ — ແລ່ນ setAdminPassword ໃນ Apps Script ກ່ອນ" };
      if (_tooMany("admin")) return { ok: false, error: "ລອງຜິດຫຼາຍເກີນໄປ — ລໍ 15 ນາທີ" };
      if (!_checkPw(String(body.password || ""), stored)) {
        _failed("admin");
        return { ok: false, error: "ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" };
      }
      return { ok: true, token: _adminToken() };
    }
    function adminList(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var sh = _inbox();
      if (sh.getLastRow() < 2) return { items: [] };
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, INBOX_HEAD.length).getValues();
      var since = Date.now() - (parseInt(body.days) || 90) * 864e5;
      return { items: rows.filter(function(r) {
        return r[0] && new Date(r[2]).getTime() >= since;
      }).map(function(r) {
        return {
          id: String(r[0]),
          type: String(r[1]),
          date: r[2],
          name: String(r[3]),
          phone: String(r[4]),
          email: String(r[5]),
          details: String(r[6]),
          total: Number(r[7]) || 0,
          payment: String(r[8]),
          delivery: String(r[9]),
          notes: String(r[10]),
          status: String(r[11]),
          updated: r[12],
          admin_note: String(r[13])
        };
      }).reverse() };
    }
    async function adminUpdate(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var sh = _inbox(), id = String(body.id || ""), last = sh.getLastRow();
      var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) {
        var row = i + 2, cur = sh.getRange(row, 1, 1, INBOX_HEAD.length).getValues()[0];
        if (body.status) {
          var isOrder = cur[1] === "order", total = Number(cur[7]) || 0;
          var ptsLater = isOrder && new Date(cur[2]).getTime() >= _ptsCutover();
          var hadPts = isOrder && (!ptsLater || cur[11] === "ສຳເລັດ");
          if (SB_WEB_.on()) {
            if (isOrder && body.status !== cur[11] && cur[11] !== "ຍົກເລີກ") {
              await SB_WEB_.rpc("web_order_status", { p_bill: id, p_status: String(body.status) });
              clearProductCache();
            }
          } else if (body.status === "ຍົກເລີກ" && cur[11] !== "ຍົກເລີກ" && isOrder) _cancelSale(id, String(cur[4]), hadPts ? total : 0);
          else if (ptsLater && body.status === "ສຳເລັດ" && cur[11] !== "ສຳເລັດ") _addPoints(String(cur[4]), Math.floor(total));
          else if (ptsLater && cur[11] === "ສຳເລັດ" && body.status !== "ສຳເລັດ") _addPoints(String(cur[4]), -Math.floor(total));
          sh.getRange(row, 12).setValue(body.status);
        }
        if (body.admin_note !== void 0) sh.getRange(row, 14).setValue(String(body.admin_note));
        sh.getRange(row, 13).setValue(/* @__PURE__ */ new Date());
        return { ok: true };
      }
      throw new Error("ບໍ່ພົບລາຍການ " + id);
    }
    var MEDIA_SHEET = "WebMedia", MEDIA_HEAD = ["ID", "SKU", "Type", "URL", "FileID", "Color", "Order", "Updated"];
    var MEDIA_FOLDER = "Sevenday Product Media";
    function _mediaSheet() {
      var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName(MEDIA_SHEET);
      if (!sh) {
        sh = ss.insertSheet(MEDIA_SHEET);
        sh.appendRow(MEDIA_HEAD);
        sh.getRange(1, 1, 1, MEDIA_HEAD.length).setFontWeight("bold");
        sh.setFrozenRows(1);
      }
      return sh;
    }
    var _mediaAll = null;
    function _mediaMap() {
      if (_mediaAll) return _mediaAll;
      _mediaAll = {};
      var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MEDIA_SHEET);
      if (!sh || sh.getLastRow() < 2) return _mediaAll;
      sh.getRange(2, 1, sh.getLastRow() - 1, MEDIA_HEAD.length).getValues().forEach(function(r) {
        if (!r[0] || !r[1]) return;
        var k = String(r[1]).toLowerCase();
        (_mediaAll[k] = _mediaAll[k] || []).push({ id: String(r[0]), type: String(r[2]), url: String(r[3]), file_id: String(r[4] || ""), color: String(r[5] || ""), order: Number(r[6]) || 0 });
      });
      Object.keys(_mediaAll).forEach(function(k) {
        _mediaAll[k].sort(function(a, b) {
          return a.order - b.order;
        });
      });
      return _mediaAll;
    }
    function _mediaPublic(m) {
      var o = { type: m.type, url: m.url, color: m.color };
      if (m.type === "image") o.thumb = m.file_id ? "https://lh3.googleusercontent.com/d/" + m.file_id + "=w300" : m.url;
      if (m.type === "video" && m.file_id) {
        o.embed = "https://drive.google.com/file/d/" + m.file_id + "/preview";
        o.thumb = "https://drive.google.com/thumbnail?id=" + m.file_id + "&sz=w400";
      }
      if (m.type === "tiktok") {
        var t = String(m.url).match(/video\/(\d+)/);
        if (t) o.embed = "https://www.tiktok.com/embed/v2/" + t[1];
      }
      if (m.type === "youtube") {
        var y = _ytId(m.url);
        if (y) {
          o.embed = "https://www.youtube-nocookie.com/embed/" + y;
          o.thumb = "https://i.ytimg.com/vi/" + y + "/hqdefault.jpg";
        }
      }
      return o;
    }
    function _ytId(u) {
      var m = String(u).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : "";
    }
    async function resolveVideo(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var u = String(body.url || "").trim();
      if (!/^https:\/\//.test(u)) throw new Error("ລິ້ງບໍ່ຖືກຕ້ອງ");
      if (/(^|\.)tiktok\.com\//.test(u.replace(/^https:\/\//, ""))) {
        if (!/\/video\/\d+/.test(u)) {
          for (var i = 0; i < 5 && !/\/video\/\d+/.test(u); i++) {
            var r = await fetch(u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
            var loc = r.headers.get("location");
            if (!loc) break;
            u = String(loc);
          }
        }
        var id = u.match(/\/video\/(\d+)/);
        if (!id) throw new Error("ອ່ານລິ້ງ TikTok ບໍ່ໄດ້ — ໃຊ້ລິ້ງເຕັມ (tiktok.com/@…/video/…)");
        var who = u.match(/tiktok\.com\/(@[^\/?]+)/);
        return { type: "tiktok", url: "https://www.tiktok.com/" + (who ? who[1] : "@") + "/video/" + id[1] };
      }
      if (_ytId(u)) return { type: "youtube", url: "https://www.youtube.com/watch?v=" + _ytId(u) };
      throw new Error("ຮອງຮັບລິ້ງ TikTok ແລະ YouTube");
    }
    function mediaUpload(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var m = String(body.data || "").match(/^data:((?:image\/(?:jpeg|png|webp))|(?:video\/(?:mp4|quicktime|webm)));base64,([A-Za-z0-9+\/=]+)$/);
      if (!m) throw new Error("ຮອງຮັບສະເພາະຮູບ JPG/PNG/WebP ຫຼື ວິດີໂອ MP4/MOV");
      var bytes = Utilities.base64Decode(m[2]), isVid = /^video/.test(m[1]);
      if (bytes.length > (isVid ? 30 : 8) * 1024 * 1024) throw new Error(isVid ? "ວິດີໂອໃຫຍ່ເກີນ 30MB" : "ຮູບໃຫຍ່ເກີນ 8MB");
      var it = DriveApp.getFoldersByName(MEDIA_FOLDER), folder = it.hasNext() ? it.next() : DriveApp.createFolder(MEDIA_FOLDER);
      var ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" }[m[1]];
      var sku = String(body.sku || "x").replace(/[^\w-]/g, "_").slice(0, 40);
      var f = folder.createFile(Utilities.newBlob(bytes, m[1], sku + "-" + Date.now() + ext));
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return { type: isVid ? "video" : "image", file_id: "", url: f.getUrl() };
    }
    function mediaList(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var sku = String(body.sku || "");
      return { sku, media: (_mediaMap()[sku.toLowerCase()] || []).map(function(m) {
        var o = _mediaPublic(m);
        o.file_id = m.file_id;
        return o;
      }) };
    }
    function mediaSave(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var sku = String(body.sku || "").trim();
      if (!sku) throw new Error("sku required");
      var items = (Array.isArray(body.items) ? body.items : []).slice(0, 30).map(function(x) {
        var t = String(x.type), url = String(x.url || "").trim();
        if (["image", "video", "tiktok", "youtube"].indexOf(t) < 0 || !/^https:\/\/[^\s"'<>]+$/.test(url)) return null;
        return { type: t, url: url.slice(0, 500), file_id: String(x.file_id || "").replace(/[^\w-]/g, "").slice(0, 80), color: String(x.color || "").replace(/[<>]/g, "").slice(0, 40) };
      }).filter(Boolean);
      var lock = LockService.getScriptLock();
      lock.waitLock(2e4);
      try {
        var sh = _mediaSheet(), last = sh.getLastRow(), now = /* @__PURE__ */ new Date();
        if (last > 1) {
          var ids = sh.getRange(2, 2, last - 1, 1).getValues();
          for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).toLowerCase() === sku.toLowerCase()) sh.deleteRow(i + 2);
        }
        items.forEach(function(x, i2) {
          sh.appendRow(["M" + now.getTime() + "-" + i2, "'" + sku, x.type, x.url, x.file_id, x.color, i2 + 1, now]);
        });
      } finally {
        lock.releaseLock();
      }
      _mediaAll = null;
      clearProductCache();
      _ghKick();
      return { sku, saved: items.length };
    }
    var SITE_KEY = "SITE_CONFIG";
    function _cleanUrl(u) {
      u = String(u || "").trim();
      return /^https:\/\/[^\s"'<>]+$/.test(u) ? u.slice(0, 500) : "";
    }
    function _cleanTxt(v, n) {
      return String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, n || 200);
    }
    function _cleanLang(o, n) {
      o = o || {};
      return { lo: _cleanTxt(o.lo, n), th: _cleanTxt(o.th, n), en: _cleanTxt(o.en, n) };
    }
    function _cleanLink(u) {
      u = String(u || "").trim();
      return /^(https:\/\/|[a-z0-9-]+\.html)[^\s"'<>]*$/i.test(u) ? u.slice(0, 300) : "";
    }
    function _hm(v) {
      v = String(v || "").trim();
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "";
    }
    function _siteRead() {
      var P = PropertiesService.getScriptProperties(), raw = P.getProperty(SITE_KEY) || "";
      var m = raw.match(/^#chunks:(\d+)$/);
      if (m) {
        raw = "";
        for (var i = 0; i < +m[1]; i++) raw += P.getProperty(SITE_KEY + "#" + i) || "";
      }
      return raw;
    }
    function _siteWrite(json2) {
      var P = PropertiesService.getScriptProperties(), old = (P.getProperty(SITE_KEY) || "").match(/^#chunks:(\d+)$/), n = 0, all = {};
      for (var i = 0; i < json2.length; i += 2500) {
        all[SITE_KEY + "#" + n] = json2.slice(i, i + 2500);
        n++;
      }
      if (old) for (var j = n; j < +old[1]; j++) P.deleteProperty(SITE_KEY + "#" + j);
      all[SITE_KEY] = "#chunks:" + n;
      P.setProperties(all);
    }
    var SVC_CACHE = "web_pos_services_v1";
    function _posServices() {
      var SVK = SB_WEB_.on() ? "web_pos_services_sb1" : SVC_CACHE;
      try {
        var cc = CacheService.getScriptCache().get(SVK);
        if (cc) return JSON.parse(cc);
      } catch (e) {
      }
      if (SB_WEB_.on()) {
        var C = _sbCat(), so = [];
        C.products.forEach(function(p) {
          if (!(p.variants || []).length) return;
          if (!/บริการ|ບໍລິການ|service/i.test(String(p.type || "")) && _subOf(p.category, p.type).group !== "service") return;
          var pr = _prices(_sbPrice(p));
          so.push({
            sku: String(p.sku).trim(),
            name: String(p.name || "").trim(),
            category: String(p.category || "").trim(),
            price_thb: pr.thb,
            price_lak: Math.round(pr.lak / 1e3) * 1e3,
            price_usd: pr.usd,
            hidden: !!(C.only_websell && !p.web_sell)
          });
        });
        try {
          CacheService.getScriptCache().put(SVK, JSON.stringify(so), 600);
        } catch (e) {
        }
        return so;
      }
      var sh = _sheet(SN.PRODUCTS), last = sh.getLastRow(), out = [];
      if (last < 2) return out;
      var H = sh.getRange(1, 1, 1, 12).getValues()[0], HC = -1;
      for (var h = 0; h < H.length; h++) if (/ซ่อน|ຊ່ອນ|hide/i.test(String(H[h]))) {
        HC = h;
        break;
      }
      sh.getRange(2, 1, last - 1, Math.max(10, HC + 1)).getValues().forEach(function(r) {
        if (!r[0]) return;
        var type = String(r[8] || ""), cat = String(r[2] || "");
        if (!/บริการ|ບໍລິການ|service/i.test(type) && _subOf(cat, type).group !== "service") return;
        var p = _prices(parseFloat(r[4]) || 0);
        out.push({
          sku: String(r[0]).trim(),
          name: String(r[1] || "").trim(),
          category: cat.trim(),
          price_thb: p.thb,
          price_lak: Math.round(p.lak / 1e3) * 1e3,
          price_usd: p.usd,
          hidden: _isHidden(r, HC)
        });
      });
      try {
        CacheService.getScriptCache().put(SVC_CACHE, JSON.stringify(out), 600);
      } catch (e) {
      }
      return out;
    }
    function getServices() {
      return { services: _posServices() };
    }
    function _svcFind(sku) {
      sku = String(sku || "").trim().toLowerCase();
      if (!sku) return null;
      var L = _posServices();
      for (var i = 0; i < L.length; i++) if (L[i].sku.toLowerCase() === sku) return L[i];
      return null;
    }
    function _svcLink(sv) {
      if (!sv) return sv;
      var L = null;
      ["packages", "repairs", "film"].forEach(function(k) {
        (sv[k] || []).forEach(function(p) {
          if (!p.sku) return;
          if (!L) {
            L = {};
            _posServices().forEach(function(x2) {
              L[x2.sku.toLowerCase()] = x2;
            });
          }
          var x = L[String(p.sku).trim().toLowerCase()];
          if (x) {
            p.price_lak = x.price_lak;
            p.price_thb = x.price_thb;
            p.pos_name = x.name;
            p.linked = true;
          } else p.linked = false;
        });
      });
      return sv;
    }
    function getSiteConfigPublic() {
      var c = getSiteConfig();
      if (c.services) c.services = _svcLink(c.services);
      return c;
    }
    function _addServiceLine(jobId, service) {
      try {
        var sku = _RQ().svcSku(service);
        if (!sku) return;
        var x = _svcFind(sku);
        if (!x) return;
        var ss = SpreadsheetApp.openById(SHEET_ID), parts = ss.getSheetByName("RepairParts"), jobs = ss.getSheetByName(SN.REPAIR);
        if (!parts || !jobs) return;
        parts.appendRow([jobId, x.sku, x.name, 1, x.price_thb, x.price_thb, /* @__PURE__ */ new Date()]);
        var ids = jobs.getRange(2, 1, jobs.getLastRow() - 1, 1).getValues();
        for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === jobId) {
          var row = jobs.getRange(i + 2, 9, 1, 3).getValues()[0], labor = parseFloat(row[0]) || 0, partsCost = (parseFloat(row[1]) || 0) + x.price_thb;
          jobs.getRange(i + 2, 10, 1, 2).setValues([[partsCost, labor + partsCost]]);
          break;
        }
      } catch (e) {
        Logger.log("addServiceLine: " + e.message);
      }
    }
    function getSiteConfig() {
      var raw = _siteRead();
      try {
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    }
    function _num(v, max) {
      v = Math.round(parseFloat(v));
      return isNaN(v) || v < 0 ? "" : Math.min(v, max || 1e9);
    }
    function _cleanServices(sv) {
      sv = sv || {};
      return {
        packages: (Array.isArray(sv.packages) ? sv.packages : []).slice(0, 6).map(function(p) {
          return {
            name: _cleanTxt(p.name, 40),
            sku: _cleanTxt(p.sku, 60),
            price_lak: _num(p.price_lak),
            time: _cleanLang(p.time, 60),
            popular: !!p.popular,
            items: (Array.isArray(p.items) ? p.items : []).slice(0, 12).map(function(it) {
              return _cleanLang(it, 120);
            }).filter(function(it) {
              return it.lo || it.th || it.en;
            })
          };
        }).filter(function(p) {
          return p.name;
        }),
        repairs: (Array.isArray(sv.repairs) ? sv.repairs : []).slice(0, 16).map(function(r) {
          return { name: _cleanLang(r.name, 60), sku: _cleanTxt(r.sku, 60), desc: _cleanLang(r.desc, 120), price_lak: _num(r.price_lak), note: _cleanLang(r.note, 60), link: _cleanLink(r.link) };
        }).filter(function(r) {
          return r.name.lo || r.name.th || r.name.en;
        }),
        film: (Array.isArray(sv.film) ? sv.film : []).slice(0, 6).map(function(f) {
          return { name: _cleanTxt(f.name, 40), sku: _cleanTxt(f.sku, 60), desc: _cleanLang(f.desc, 120), price_lak: _num(f.price_lak) };
        }).filter(function(f) {
          return f.name;
        })
      };
    }
    async function saveSiteConfig(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var c = body.config || {}, out = {};
      out.logo = _cleanUrl(c.logo);
      out.slides = (Array.isArray(c.slides) ? c.slides : []).slice(0, 8).map(function(x) {
        return { image: _cleanUrl(x.image), title: _cleanLang(x.title, 120), text: _cleanLang(x.text, 240), button: _cleanLang(x.button, 40), link: _cleanLink(x.link), dark: x.dark !== false };
      }).filter(function(x) {
        return x.image;
      });
      out.hours = [];
      for (var d = 0; d < 7; d++) {
        var h = (c.hours || [])[d] || {}, o = _hm(h.open), cl = _hm(h.close);
        if (!h.closed && (!o || !cl || o >= cl)) throw new Error("ເວລາເປີດ-ປິດ ບໍ່ຖືກຕ້ອງ (ວັນທີ " + (d + 1) + ")");
        out.hours.push({ closed: !!h.closed, open: o || "09:00", close: cl || "18:00" });
      }
      var ct = c.contact || {};
      out.contact = {
        phone: _cleanTxt(ct.phone, 40),
        whatsapp: _cleanTxt(ct.whatsapp, 20).replace(/\D/g, ""),
        email: _cleanTxt(ct.email, 80),
        address: _cleanLang(ct.address, 200),
        mapUrl: _cleanUrl(ct.mapUrl),
        facebook: _cleanUrl(ct.facebook),
        tiktok: _cleanUrl(ct.tiktok)
      };
      if (c.services) out.services = _cleanServices(c.services);
      out.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      var json2 = JSON.stringify(out);
      if (json2.length > 6e4) throw new Error("ຂໍ້ມູນຍາວເກີນໄປ — ຫຼຸດຈຳນວນສະໄລ້ ຫຼື ຂໍ້ຄວາມ");
      _siteWrite(json2);
      _ghKick();
      clearProductCache();
      try {
        var skuMap = {};
        ((out.services || {}).packages || []).forEach(function(p) {
          if (p.sku) skuMap[p.name] = p.sku;
        });
        await _RQ().setConfig({ hours: out.hours, svc_sku: skuMap });
      } catch (e) {
        Logger.log("queue sync: " + e.message);
      }
      return out;
    }
    function _cancelSale(billId, phone, totalThb) {
      var sh = _sheet(SN.SALES), v = sh.getDataRange().getValues();
      for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === billId) sh.deleteRow(i + 1);
      var pts = Math.floor(totalThb);
      if (!pts) return;
      var c = _sheet(SN.CUSTOMERS), d = c.getDataRange().getValues(), clean = phone.replace(/\s/g, "");
      for (var j = 1; j < d.length; j++) if (String(d[j][2]).replace(/\s/g, "") === clean) {
        c.getRange(j + 1, 4).setValue(Math.max(0, (parseFloat(d[j][3]) || 0) - pts));
        break;
      }
      clearProductCache();
    }
    function _ok(data) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        data,
        ts: (/* @__PURE__ */ new Date()).toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    function _err(code, msg) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg, code })).setMimeType(ContentService.MimeType.JSON);
    }
    function _rates() {
      try {
        if (SB_WEB_.on()) {
          var RT = _sbCat().rates || {};
          return { lakToThb: parseFloat(RT.LAK) || 698, usdToThb: parseFloat(RT.USD) || 0.031 };
        }
        var rows = _rows(SN.SETTINGS).rows;
        var map = {};
        rows.forEach(function(r) {
          if (r[0]) map[String(r[0])] = r[1];
        });
        return {
          // POS ບັນທຶກເປັນ LAK_PER_THB / USD_PER_THB (ໜ້າ ຕັ້ງຄ່າ → ອັດຕາແລກປ່ຽນ) — ຊື່ເກົ່າ LAK_TO_THB ໃຊ້ສຳຮອງ
          lakToThb: parseFloat(map["LAK_PER_THB"] || map["LAK_TO_THB"] || map["LAK_RATE"] || 698),
          usdToThb: parseFloat(map["USD_PER_THB"] || map["USD_TO_THB"] || map["USD_RATE"] || 0.031)
        };
      } catch (e) {
        return { lakToThb: 698, usdToThb: 0.031 };
      }
    }
    function _prices(thb) {
      var r = _rates();
      return {
        thb: Math.round(thb),
        lak: Math.round(thb * r.lakToThb),
        usd: parseFloat((thb * r.usdToThb).toFixed(2))
      };
    }
    function _auth(e) {
      if (e.parameter && e.parameter.secret === WEB_SECRET) return true;
      if (e.pathInfo && e.pathInfo.trim() === WEB_SECRET) return true;
      try {
        if (e.postData) {
          var b = JSON.parse(e.postData.contents);
          if (b.secret === WEB_SECRET) return true;
        }
      } catch (_) {
      }
      return false;
    }
    function _billId() {
      return "BI-WEB-" + (/* @__PURE__ */ new Date()).getTime();
    }
    function _repairId() {
      var d = /* @__PURE__ */ new Date();
      return "RE-" + Utilities.formatDate(d, "Asia/Vientiane", "yyyyMMdd-HHmm") + "-" + ("0" + Math.floor(Math.random() * 100)).slice(-2) + String(d.getTime()).slice(-1);
    }
    function _bookingId() {
      return "BK-WEB-" + (/* @__PURE__ */ new Date()).getTime();
    }
    function _custId() {
      return "CU-WEB-" + (/* @__PURE__ */ new Date()).getTime();
    }
    var CACHE_SEC = 900;
    function _ck() {
      return SB_WEB_.on() ? "web_products_sb1" : "web_products_v2";
    }
    function _cacheGet(K) {
      K = K || _ck();
      try {
        var c = CacheService.getScriptCache(), n = parseInt(c.get(K + "_n") || "0");
        if (!n) return null;
        var keys = [];
        for (var i = 0; i < n; i++) keys.push(K + "_" + i);
        var parts = c.getAll(keys), str = "";
        for (var j = 0; j < n; j++) {
          if (!parts[keys[j]]) return null;
          str += parts[keys[j]];
        }
        return JSON.parse(str);
      } catch (e) {
        return null;
      }
    }
    function _cachePut(list, K) {
      K = K || _ck();
      try {
        var str = JSON.stringify(list), size = /sb/.test(K) ? 3e4 : 9e4, obj = {}, n = Math.ceil(str.length / size);
        for (var i = 0; i < n; i++) obj[K + "_" + i] = str.substr(i * size, size);
        obj[K + "_n"] = String(n);
        CacheService.getScriptCache().putAll(obj, CACHE_SEC);
      } catch (e) {
        Logger.log("cache put error: " + e.message);
      }
    }
    function clearProductCache() {
      try {
        CacheService.getScriptCache().removeAll(["web_products_v2_n", "web_products_sb1_n", "web_sb_catalog_n", "web_pos_services_v1", "web_pos_services_sb1"]);
      } catch (e) {
      }
      _sbCatMemo = null;
    }
    var _sbCatMemo = null;
    function _sbCat() {
      if (_sbCatMemo) return _sbCatMemo;
      var c = _cacheGet("web_sb_catalog");
      if (!c) {
        c = SB_WEB_.rpc("web_catalog", {});
        _cachePut(c, "web_sb_catalog");
      }
      return _sbCatMemo = c;
    }
    function _sbSingle(p) {
      var vs = p.variants || [];
      return vs.length === 1 && String(vs[0].sku).toLowerCase() === String(p.sku).toLowerCase() ? vs[0] : null;
    }
    function _sbPrice(p) {
      var b = _sbSingle(p);
      if (b) return Number(b.price) || 0;
      var ps = (p.variants || []).map(function(v) {
        return Number(v.price) || 0;
      }).filter(function(x) {
        return x > 0;
      });
      return ps.length ? Math.min.apply(null, ps) : 0;
    }
    function _sbStock(p) {
      var b = _sbSingle(p);
      if (b) return Number(b.stock) || 0;
      return (p.variants || []).reduce(function(a, v) {
        return a + Math.max(0, Number(v.stock) || 0);
      }, 0);
    }
    function _sbVisible(C, p) {
      return (p.variants || []).length > 0 && (!C.only_websell || p.web_sell);
    }
    function _sbCover(p) {
      var L = _mediaMap()[String(p.sku).toLowerCase()] || [];
      for (var i = 0; i < L.length; i++) if (L[i].type === "image") return L[i].file_id ? "https://lh3.googleusercontent.com/d/" + L[i].file_id + "=w800" : L[i].url;
      var pu = _posImgMap()[String(p.sku)];
      if (pu) return pu;
      var m = _webImgMap()[String(p.sku)];
      if (m && m.id) return "https://lh3.googleusercontent.com/d/" + m.id + "=w800";
      return p.image ? _imgUrl(p.image) : "";
    }
    function _allProducts() {
      var cached = _cacheGet();
      if (cached) return cached;
      if (SB_WEB_.on()) {
        var C = _sbCat(), VMS = _variantMap(), out = [];
        C.products.forEach(function(p) {
          if (!_sbVisible(C, p)) return;
          var pr = _prices(_sbPrice(p)), so = _subOf(p.category, p.type), st = _sbStock(p);
          var o = {
            sku: String(p.sku),
            name: String(p.name || ""),
            category: String(p.category || ""),
            price_thb: pr.thb,
            price_lak: pr.lak,
            price_usd: pr.usd,
            stock: st,
            in_stock: st > 0,
            unit: String(p.unit || ""),
            type: String(p.type || ""),
            image: _sbCover(p),
            group: so.group,
            sub: so.sub
          };
          var vv = VMS[String(p.sku).trim().toLowerCase()];
          if (vv && vv.length) {
            o.variants = vv.length;
            o.colors = _uniqCI(vv.map(function(v) {
              return v.color;
            }));
            o.sizes = _uniqCI(vv.map(function(v) {
              return v.size;
            }));
            o.vkeys = vv.map(function(v) {
              return [v.sku, v.barcode, v.color].join(" ");
            }).join(" ").toLowerCase();
          }
          out.push(o);
        });
        out = out.filter(function(p) {
          return p.group !== "service";
        });
        _cachePut(out);
        return out;
      }
      var _P = _rows(SN.PRODUCTS), IC = _imgCol(_P.headers), HC = _hideCol(_P.headers), VM = _variantMap();
      var list = _P.rows.filter(function(r) {
        return r[0] && !_isHidden(r, HC);
      }).map(function(r) {
        var stock = parseFloat(r[5]) || 0;
        var p = _prices(parseFloat(r[4]) || 0);
        var vs = VM[String(r[0]).trim().toLowerCase()];
        var o = {
          sku: String(r[0]),
          name: String(r[1] || ""),
          category: String(r[2] || ""),
          price_thb: p.thb,
          price_lak: p.lak,
          price_usd: p.usd,
          stock,
          in_stock: stock > 0,
          unit: String(r[6] || ""),
          type: String(r[8] || ""),
          image: _coverImg(r[0], r[IC]),
          group: _subOf(r[2], r[8]).group,
          sub: _subOf(r[2], r[8]).sub
        };
        if (vs && vs.length) {
          var vst = vs.reduce(function(a, v) {
            return a + Math.max(0, v.stock);
          }, 0);
          o.stock = vst;
          o.in_stock = vst > 0;
          o.variants = vs.length;
          o.colors = _uniqCI(vs.map(function(v) {
            return v.color;
          }));
          o.sizes = _uniqCI(vs.map(function(v) {
            return v.size;
          }));
          o.vkeys = vs.map(function(v) {
            return [v.sku, v.barcode, v.color].join(" ");
          }).join(" ").toLowerCase();
        }
        return o;
      }).filter(function(p) {
        return p.group !== "service";
      });
      _cachePut(list);
      return list;
    }
    function getProducts(params) {
      var category = (params.category || "").toLowerCase();
      var search = (params.search || "").toLowerCase();
      var inStock = params.in_stock === "true";
      var page = Math.max(1, parseInt(params.page || 1));
      var limit = Math.min(1e3, parseInt(params.limit || 24));
      var products = _allProducts().filter(function(p) {
        return !category || p.group === category || p.sub === category || p.category.toLowerCase().indexOf(category) > -1;
      }).filter(function(p) {
        return !search || p.name.toLowerCase().indexOf(search) > -1 || p.sku.toLowerCase().indexOf(search) > -1 || (p.vkeys || "").indexOf(search) > -1;
      }).filter(function(p) {
        return !inStock || p.in_stock;
      });
      var total = products.length;
      var pages = Math.ceil(total / limit);
      var offset = (page - 1) * limit;
      return {
        data: products.slice(offset, offset + limit),
        meta: { total, page, limit, pages }
      };
    }
    function _variantMap() {
      if (SB_WEB_.on()) {
        var M = {};
        _sbCat().products.forEach(function(p) {
          if (_sbSingle(p) || !(p.variants || []).length) return;
          var cn = {}, cv = function(kind, v) {
            v = String(v || "").trim();
            if (!v) return "";
            var k = kind + "|" + v.toLowerCase();
            return cn[k] || (cn[k] = v);
          };
          M[String(p.sku).trim().toLowerCase()] = p.variants.map(function(v) {
            return {
              id: String(v.sku),
              color: cv("c", v.color),
              size: cv("s", v.size),
              sku: String(v.sku).trim(),
              barcode: String(v.barcode || "").trim(),
              price: Number(v.price) || 0,
              stock: Number(v.stock) || 0
            };
          });
        });
        return M;
      }
      var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SN.VARIANTS);
      var map = {};
      if (!sh || sh.getLastRow() < 2) return map;
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
      var canon = {};
      rows.forEach(function(r) {
        if (!r[0] || !r[1]) return;
        var st = String(r[10] || "").toLowerCase();
        if (st && st !== "active") return;
        var key = String(r[1]).trim().toLowerCase();
        var cv = function(kind, v) {
          v = String(v || "").trim();
          if (!v) return "";
          var k = key + "|" + kind + "|" + v.toLowerCase();
          return canon[k] || (canon[k] = v);
        };
        (map[key] = map[key] || []).push({
          id: String(r[0]),
          color: cv("c", r[3]),
          size: cv("s", r[4]),
          sku: String(r[5] || r[0]).trim(),
          barcode: String(r[6] || "").trim(),
          price: parseFloat(r[8]) || 0,
          stock: parseFloat(r[9]) || 0
        });
      });
      return map;
    }
    function _uniqCI(a) {
      var seen = {}, out = [];
      a.forEach(function(x) {
        if (x && !seen[x.toLowerCase()]) {
          seen[x.toLowerCase()] = 1;
          out.push(x);
        }
      });
      return out;
    }
    function _coverImg(sku, v) {
      var L = _mediaMap()[String(sku).toLowerCase()] || [];
      for (var i = 0; i < L.length; i++) if (L[i].type === "image") return L[i].file_id ? "https://lh3.googleusercontent.com/d/" + L[i].file_id + "=w800" : L[i].url;
      return _webImg(sku, v);
    }
    function exportCatalog() {
      var VM = _variantMap(), MM = _mediaMap();
      var products = _allProducts().map(function(p) {
        var o = {};
        for (var k in p) if (k !== "vkeys") o[k] = p[k];
        var vs = VM[String(p.sku).trim().toLowerCase()];
        if (vs && vs.length) o.vlist = vs.map(function(v) {
          return { variant_id: v.id, color: v.color, size: v.size, sku: v.sku, barcode: v.barcode, price_thb: v.price || p.price_thb, stock: v.stock };
        });
        var md = MM[String(p.sku).toLowerCase()];
        if (md && md.length) o.media = md.map(_mediaPublic);
        return o;
      });
      return { t: (/* @__PURE__ */ new Date()).toISOString(), products, site: getSiteConfigPublic() };
    }
    function _ghKick() {
      try {
        var tok = PropertiesService.getScriptProperties().getProperty("GH_TOKEN");
        if (!tok) return;
        __later(function() {
          return fetch("https://api.github.com/repos/lockxayasing2021-boop/sevenday-bike/actions/workflows/sync-catalog.yml/dispatches", {
            method: "POST",
            headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "sevenday-web-api" },
            body: JSON.stringify({ ref: "main" })
          });
        });
      } catch (e) {
        Logger.log("ghKick: " + e.message);
      }
    }
    function getProduct(sku) {
      if (!sku) throw new Error("sku required");
      if (SB_WEB_.on()) {
        var C = _sbCat(), lk = String(sku).trim().toLowerCase(), P = null;
        C.products.forEach(function(x) {
          if (!P && String(x.sku).toLowerCase() === lk && _sbVisible(C, x)) P = x;
        });
        if (!P) throw new Error("Product not found: " + sku);
        var b = _sbSingle(P), pp = _prices(_sbPrice(P)), so = _subOf(P.category, P.type), st = _sbStock(P);
        return {
          sku: String(P.sku),
          name: String(P.name || ""),
          category: String(P.category || ""),
          price_thb: pp.thb,
          price_lak: pp.lak,
          price_usd: pp.usd,
          stock: st,
          in_stock: st > 0,
          unit: String(P.unit || ""),
          barcode: b ? String(b.barcode || "") : "",
          image: _sbCover(P),
          group: so.group,
          sub: so.sub,
          variants: (_variantMap()[lk] || []).map(function(v) {
            return { variant_id: v.id, color: v.color, size: v.size, sku: v.sku, barcode: v.barcode, price_thb: v.price || pp.thb, stock: v.stock };
          }),
          media: (_mediaMap()[lk] || []).map(_mediaPublic)
        };
      }
      var _P = _rows(SN.PRODUCTS), IC = _imgCol(_P.headers), HC = _hideCol(_P.headers);
      var pRows = _P.rows.filter(function(r) {
        return !_isHidden(r, HC);
      });
      var prod = null;
      for (var i = 0; i < pRows.length; i++) {
        if (String(pRows[i][0]).toLowerCase() === sku.toLowerCase()) {
          prod = pRows[i];
          break;
        }
      }
      if (!prod) throw new Error("Product not found: " + sku);
      var p = _prices(parseFloat(prod[4]) || 0);
      var variants = (_variantMap()[String(prod[0]).trim().toLowerCase()] || []).map(function(v) {
        return {
          variant_id: v.id,
          color: v.color,
          size: v.size,
          sku: v.sku,
          barcode: v.barcode,
          price_thb: v.price || p.thb,
          stock: v.stock
        };
      });
      return {
        sku: String(prod[0]),
        name: String(prod[1] || ""),
        category: String(prod[2] || ""),
        price_thb: p.thb,
        price_lak: p.lak,
        price_usd: p.usd,
        stock: parseFloat(prod[5]) || 0,
        in_stock: (parseFloat(prod[5]) || 0) > 0,
        unit: String(prod[6] || ""),
        barcode: String(prod[7] || ""),
        image: _coverImg(prod[0], prod[IC]),
        group: _subOf(prod[2], prod[8]).group,
        sub: _subOf(prod[2], prod[8]).sub,
        variants,
        media: (_mediaMap()[String(prod[0]).toLowerCase()] || []).map(_mediaPublic)
      };
    }
    function checkStockMany(params) {
      var skus = String(params.skus || "").split(",").map(function(x) {
        return x.trim();
      }).filter(Boolean).slice(0, 50), m = {};
      if (!skus.length) return { stock: [] };
      _allProducts().forEach(function(p) {
        m[String(p.sku).toLowerCase()] = p.stock;
      });
      var VM = _variantMap();
      Object.keys(VM).forEach(function(k) {
        VM[k].forEach(function(v) {
          m[String(v.sku).toLowerCase()] = v.stock;
        });
      });
      return { stock: skus.filter(function(s) {
        return m[s.toLowerCase()] !== void 0;
      }).map(function(s) {
        return { sku: s, stock: m[s.toLowerCase()] };
      }) };
    }
    async function checkStock(params) {
      var sku = params.sku;
      var qty = parseFloat(params.qty || 1);
      if (!sku) throw new Error("sku required");
      if (SB_WEB_.on()) {
        var S = await SB_WEB_.rpc("web_stock", { p_sku: String(sku) });
        if (!S) return { sku, available: false, stock: 0, requested: qty };
        var sq = Number(S.stock) || 0;
        return { sku: String(S.sku), name: String(S.name || ""), stock: sq, requested: qty, available: sq >= qty };
      }
      var rows = _rows(SN.PRODUCTS).rows;
      var prod = null;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).toLowerCase() === sku.toLowerCase()) {
          prod = rows[i];
          break;
        }
      }
      if (!prod) return { sku, available: false, stock: 0, requested: qty };
      var stock = parseFloat(prod[5]) || 0;
      return {
        sku: String(prod[0]),
        name: String(prod[1] || ""),
        stock,
        requested: qty,
        available: stock >= qty
      };
    }
    function getCustomer(phone) {
      if (!phone) throw new Error("phone required");
      var rows = _rows(SN.CUSTOMERS).rows;
      var clean = String(phone).replace(/\s/g, "");
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][2]).replace(/\s/g, "") === clean) {
          row = rows[i];
          break;
        }
      }
      if (!row) return null;
      return {
        customer_id: String(row[0]),
        name: String(row[1] || ""),
        phone: String(row[2] || ""),
        points: parseFloat(row[3]) || 0
      };
    }
    function _hex(bytes) {
      return bytes.map(function(b) {
        return ("0" + (b & 255).toString(16)).slice(-2);
      }).join("");
    }
    function _sha(str) {
      return _hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
    }
    function _hashPw(pw, salt) {
      salt = salt || Utilities.getUuid().replace(/-/g, "").slice(0, 16);
      var h = pw;
      for (var i = 0; i < 200; i++) h = _sha(salt + h);
      return "sha256$" + salt + "$" + h;
    }
    function _checkPw(pw, stored) {
      stored = String(stored || "");
      if (stored.indexOf("sha256$") === 0) {
        var parts = stored.split("$");
        return _hashPw(pw, parts[1]) === stored;
      }
      return stored !== "" && stored.trim() === pw;
    }
    function _sessionKey() {
      var pr = PropertiesService.getScriptProperties(), k = pr.getProperty("SESSION_KEY");
      if (!k) {
        k = Utilities.getUuid() + Utilities.getUuid();
        pr.setProperty("SESSION_KEY", k);
      }
      return k;
    }
    function _makeToken(custId) {
      var exp = Date.now() + 30 * 24 * 3600 * 1e3, payload = custId + "|" + exp;
      var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _sessionKey()));
      return Utilities.base64EncodeWebSafe(payload) + "." + sig;
    }
    function _readToken(token) {
      try {
        var t = String(token || "").split(".");
        if (t.length !== 2) return null;
        var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(t[0])).getDataAsString();
        var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _sessionKey()));
        if (sig !== t[1]) return null;
        var p = payload.split("|");
        if (Date.now() > Number(p[1])) return null;
        return p[0];
      } catch (e) {
        return null;
      }
    }
    function _tooMany(email) {
      var c = CacheService.getScriptCache(), k = "lf_" + _sha(email).slice(0, 20);
      return parseInt(c.get(k) || "0") >= 5;
    }
    function _failed(email) {
      var c = CacheService.getScriptCache(), k = "lf_" + _sha(email).slice(0, 20);
      c.put(k, String(parseInt(c.get(k) || "0") + 1), 900);
    }
    function _publicUser(row, custId) {
      return {
        ok: true,
        customer_id: String(custId || row[0]),
        name: String(row[1] || ""),
        phone: String(row[2] || ""),
        points: parseFloat(row[3]) || 0,
        email: String(row[5] || ""),
        token: _makeToken(String(custId || row[0]))
      };
    }
    async function loginCustomer(body) {
      var email = String(body.email || "").toLowerCase().trim();
      var password = String(body.password || "");
      if (!email || !password) throw new Error("email and password required");
      if (_tooMany(email)) return { ok: false, error: "ລອງລະຫັດຜິດຫຼາຍເກີນໄປ — ລໍ 15 ນາທີ ແລ້ວລອງໃໝ່" };
      if (SB_WEB_.on()) {
        var U = await SB_WEB_.rpc("web_customer_find", { p_email: email });
        if (!U || !_checkPw(password, U.pw)) {
          _failed(email);
          return { ok: false, error: "ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" };
        }
        if (String(U.pw || "").indexOf("sha256$") !== 0) {
          try {
            await SB_WEB_.rpc("web_customer_set_pw", { p_id: U.customer_id, p_hash: _hashPw(password) });
          } catch (e) {
            Logger.log("set_pw: " + e.message);
          }
        }
        return _publicUser([U.customer_id, U.name, U.phone, U.points, "", U.email]);
      }
      var R = _rows(SN.CUSTOMERS), idx = -1;
      for (var i = 0; i < R.rows.length; i++) {
        if (String(R.rows[i][5] || "").toLowerCase().trim() === email) {
          idx = i;
          break;
        }
      }
      if (idx < 0 || !_checkPw(password, R.rows[idx][6])) {
        _failed(email);
        return { ok: false, error: "ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" };
      }
      var row = R.rows[idx];
      if (String(row[6] || "").indexOf("sha256$") !== 0) {
        R.sheet.getRange(idx + 2, 7).setValue(_hashPw(password));
      }
      return _publicUser(row);
    }
    function hashAllPasswords() {
      var R = _rows(SN.CUSTOMERS), n = 0;
      R.rows.forEach(function(r, i) {
        var v = String(r[6] || "");
        if (v && v.indexOf("sha256$") !== 0) {
          R.sheet.getRange(i + 2, 7).setValue(_hashPw(v.trim()));
          n++;
        }
      });
      return n;
    }
    async function registerCustomer(body) {
      var name = String(body.name || "").trim();
      var phone = String(body.phone || "").replace(/\s/g, "");
      var email = String(body.email || "").toLowerCase().trim();
      var password = String(body.password || "");
      if (!name || !phone || !email || !password) throw new Error("name, phone, email, password required");
      if (password.length < 6) return { ok: false, error: "ລະຫັດຜ່ານຕ້ອງມີ 6 ໂຕຂຶ້ນໄປ" };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "ຮູບແບບອີເມວບໍ່ຖືກຕ້ອງ" };
      if (SB_WEB_.on()) {
        var RG = await SB_WEB_.rpc("web_customer_register", { p: { name, phone, email, pw: _hashPw(password) } });
        if (!RG.ok) return { ok: false, error: RG.code === "EMAIL_EXISTS" ? "ອີເມວນີ້ມີບັນຊີແລ້ວ — ລອງເຂົ້າສູ່ລະບົບ" : "ເບີໂທນີ້ມີໃນລະບົບຮ້ານແລ້ວ — ຕິດຕໍ່ຮ້ານເພື່ອເປີດບັນຊີອອນລາຍ ແລະ ຮັບແຕ້ມເດີມ" };
        return _publicUser([RG.customer_id, RG.name, RG.phone, RG.points, "", RG.email]);
      }
      var rows = _rows(SN.CUSTOMERS).rows;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][5] || "").toLowerCase().trim() === email) return { ok: false, error: "ອີເມວນີ້ມີບັນຊີແລ້ວ — ລອງເຂົ້າສູ່ລະບົບ" };
        if (String(rows[i][2] || "").replace(/\s/g, "") === phone) return { ok: false, error: "ເບີໂທນີ້ມີໃນລະບົບຮ້ານແລ້ວ — ຕິດຕໍ່ຮ້ານເພື່ອເປີດບັນຊີອອນລາຍ ແລະ ຮັບແຕ້ມເດີມ" };
      }
      var custId = _custId();
      var row = [custId, name, phone, 0, /* @__PURE__ */ new Date(), email, _hashPw(password)];
      _sheet(SN.CUSTOMERS).appendRow(row);
      return _publicUser(row, custId);
    }
    async function getCustomerOrders(body) {
      var custId = _readToken(body.token), ST = null;
      if (!custId) throw new Error("SESSION_EXPIRED");
      if (SB_WEB_.on()) {
        var D = await SB_WEB_.rpc("web_customer_orders", { p_id: custId }), OL = D.orders || [], SM = OL.length ? _inboxStatusMap() : {};
        OL.forEach(function(o) {
          o.status = SM[o.bill_id] || "";
          o.total = Number(o.total) || 0;
        });
        return { orders: OL, repairs: D.repairs || [], points: Number(D.points) || 0 };
      }
      var sRows = _rows(SN.SALES).rows;
      var bills = {};
      sRows.forEach(function(r) {
        if (String(r[12] || "") !== custId) return;
        var bid = String(r[0]);
        if (!bills[bid]) bills[bid] = { bill_id: bid, date: r[1], items: [], total: 0, payment: String(r[7] || ""), status: (ST = ST || _inboxStatusMap())[bid] || "" };
        bills[bid].items.push({ sku: String(r[2] || ""), name: String(r[3] || ""), qty: r[4], price: r[5] });
        bills[bid].total += parseFloat(r[6]) || 0;
      });
      var rRows = _rows(SN.REPAIR).rows;
      var repairs = rRows.filter(function(r) {
        return String(r[14] || "") === custId;
      }).map(function(r) {
        return {
          job_id: String(r[0]),
          date: r[1],
          bike: String(r[4] || ""),
          symptoms: String(r[5] || ""),
          status: String(r[6] || ""),
          labor: parseFloat(r[8]) || 0,
          parts: parseFloat(r[9]) || 0,
          total: parseFloat(r[10]) || 0
        };
      });
      var cRows = _rows(SN.CUSTOMERS).rows;
      var points = 0;
      cRows.forEach(function(r) {
        if (String(r[0] || "") === custId) points = parseFloat(r[3]) || 0;
      });
      return {
        orders: Object.values(bills),
        repairs,
        points
      };
    }
    function getSettings() {
      var r = _rates();
      return { lak_to_thb: r.lakToThb, usd_to_thb: r.usdToThb, currency_main: "THB" };
    }
    var _rqLive = null;
    function _RQ() {
      return SB_WEB_.on() ? _rqLive || (_rqLive = _RQ_SB()) : RepairQueueEngine_(SpreadsheetApp.openById(SHEET_ID));
    }
    function _qErr(e) {
      var m = String(e && e.message || e), h = m.match(/ใช้เวลา ([\d.]+) ชั่วโมง/), nf = m.match(/ไม่พบคิว (\S+)/);
      if (/^(QUEUE_|WEB_)/.test(m)) return new Error(m);
      if (/ย้ายไปเต็ม/.test(m)) return new Error("QUEUE_FULL: ຊ່ວງທີ່ຈະຍ້າຍໄປເຕັມ ຫຼື ປິດ");
      if (/ไม่ทันในวันที่จะย้ายไป/.test(m)) return new Error("QUEUE_BUSY: ຊ່າງເຕັມ — ງານນີ້ສຳເລັດບໍ່ທັນໃນວັນທີ່ຈະຍ້າຍໄປ");
      if (/เต็มแล้ว/.test(m)) return new Error("QUEUE_FULL: ຊ່ວງເວລານີ້ເຕັມແລ້ວ — ກະລຸນາເລືອກເວລາອື່ນ");
      if (/ไม่รับจอง/.test(m)) return new Error("QUEUE_CLOSED: ຊ່ວງເວລານີ້ບໍ່ຮັບຈອງ — ກະລຸນາເລືອກເວລາອື່ນ");
      if (/ช่างเต็ม/.test(m)) return new Error("QUEUE_BUSY: ຊ່າງເຕັມ — ງານນີ້ໃຊ້ເວລາ " + (h ? h[1] : "") + " ຊົ່ວໂມງ ສຳເລັດບໍ່ທັນ. ກະລຸນາເລືອກມື້ອື່ນ");
      if (/เลือกวันที่/.test(m)) return new Error("date required");
      if (nf) return new Error("ບໍ່ພົບຄິວ " + nf[1]);
      return new Error(m);
    }
    function _RQ_SB() {
      var Q = SevendayQueue, t = Q.today(), hrs = _qHours();
      var data = SB_WEB_.rpc("web_queue_data", { p_from: Q.addDays(t, -60), p_to: Q.addDays(t, 120) }) || {};
      if (hrs) {
        data.cfg = data.cfg || {};
        data.cfg.hours = hrs;
      }
      var E = Q.Engine(data);
      function safe(f) {
        return function() {
          try {
            return f.apply(null, arguments);
          } catch (e) {
            throw _qErr(e);
          }
        };
      }
      return {
        cfg: E.cfg,
        today: E.today,
        ymd: E.ymd,
        svcSku: E.svcSku,
        readyText: E.readyText,
        readyISO: E.readyISO,
        grid: function(from, days, withEntries, hours, opt) {
          return E.grid(from, days, withEntries, hours, opt);
        },
        checkBook: safe(E.checkBook),
        update: async function(o) {
          var moved = !!(o.date || o.period), p = { id: String(o.id || "") };
          if (moved) {
            var r = safe(E.checkMove)({ id: o.id, date: o.date, period: o.period, force: !!o.force });
            p.date = E.ymd(o.date) || "";
            p.period = String(o.period || "");
            p.force = !!o.force;
            p.cap = r.cap;
            if (r.ready) {
              p.ready_text = E.readyText(r.ready);
              p.ready_iso = E.readyISO(r.ready);
            }
          }
          if (o.status) p.status = String(o.status);
          if (o.note !== void 0) p.note = String(o.note).slice(0, 300);
          await SB_WEB_.rpc("web_queue_update", { p });
          return { ok: true };
        },
        block: async function(o) {
          var d = E.ymd(o.date);
          if (!d) throw new Error("date required");
          var r = await SB_WEB_.rpc("web_queue_block", { p_bkey: o.period ? d + "|" + String(o.period) : d, p_val: E.blockValue(o) });
          return { ok: true, blocks: r.blocks };
        },
        setConfig: async function(o) {
          var c = E.newConfig(o || {});
          await SB_WEB_.rpc("web_queue_config_save", { p_cfg: c });
          return Q.Engine({ cfg: c }).publicCfg();
        }
      };
    }
    function _qHours() {
      var h = getSiteConfig().hours;
      return Array.isArray(h) && h.length === 7 ? h : null;
    }
    function getRepairSlots(params) {
      params = params || {};
      var rq = _RQ(), c = rq.cfg(), t = rq.today();
      var from = rq.ymd(params.from || params.date) || t;
      if (from < t) from = t;
      var days = params.date && !params.from ? 1 : Math.max(1, Math.min(c.days_ahead, parseInt(params.days, 10) || c.days_ahead));
      return rq.grid(from, days, false, _qHours(), { service: String(params.service || "").slice(0, 60) });
    }
    async function _qBook(body, source, force) {
      var q = body.queue || {}, c = body.customer || {};
      if (!c.phone) throw new Error("customer.phone required");
      if (!body.bike || !body.bike.model) throw new Error("bike.model required");
      var bikeTxt = String((body.bike.brand ? body.bike.brand + " " : "") + body.bike.model);
      if (SB_WEB_.on()) {
        var rq = _RQ(), qd = rq.ymd(q.date), qp = String(q.period || "");
        if (!qd) throw new Error("date required");
        var chk = rq.checkBook({ date: qd, period: qp, service: String(body.service || ""), note: String(body.notes || ""), force: !!force });
        var job = await _createRepairJob(body, source, {
          date: qd,
          period: qp,
          cap: chk.cap,
          force: !!force,
          ready_text: rq.readyText(chk.ready),
          ready_iso: rq.readyISO(chk.ready),
          service: String(body.service || ""),
          svc_sku: rq.svcSku(body.service),
          note: String(body.notes || "").slice(0, 300),
          source
        });
        job.queue = { id: job.queue_id, date: qd, period: qp, start: chk.start, end: chk.end, hours: chk.hours, ready: chk.ready };
        delete job.queue_id;
        return job;
      }
      return _RQ().book({
        date: q.date,
        period: q.period,
        name: c.name,
        phone: c.phone,
        bike: bikeTxt,
        service: String(body.service || ""),
        source,
        note: String(body.notes || ""),
        force
      }, function() {
        var j = _createRepairJob(body, source);
        _addServiceLine(j.job_id, body.service);
        return j;
      }, _qHours());
    }
    function queueAdmin(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var rq = _RQ(), from = rq.ymd(body.from) || rq.today(), days = Math.max(1, Math.min(31, parseInt(body.days, 10) || 7));
      return rq.grid(from, days, true, _qHours());
    }
    async function queueSave(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      if (body.op === "add") {
        var c = body.customer || {};
        if (!c.name || String(c.phone || "").replace(/\D/g, "").length < 8) throw new Error("ໃສ່ຊື່ ແລະ ເບີໂທ");
        return await _qBook({
          customer: c,
          bike: { model: body.bike || "-" },
          symptoms: String(body.service || "") + (body.note ? " | " + body.note : ""),
          service: body.service,
          notes: body.note,
          queue: { date: body.date, period: body.period }
        }, "แอดมิน", !!body.force);
      }
      return await _RQ().update(body, _qHours());
    }
    async function queueBlock(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      return await _RQ().block(body);
    }
    async function queueConfig(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var c = body.config || {};
      c.hours = _qHours();
      return await _RQ().setConfig(c);
    }
    async function upsertCustomer(body) {
      var c = body.customer || body;
      if (!c.phone) throw new Error("customer.phone required");
      if (SB_WEB_.on()) {
        var UC = await SB_WEB_.rpc("web_customer_upsert", { p: { name: String(c.name || ""), phone: String(c.phone) } });
        return { customer_id: UC.customer_id, name: UC.name, phone: UC.phone, points: Number(UC.points) || 0, is_new: !!UC.is_new };
      }
      var phone = String(c.phone).replace(/\s/g, "");
      var sheet = _sheet(SN.CUSTOMERS);
      var data = sheet.getDataRange().getValues();
      var rows = data.slice(1);
      var idx = -1;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][2]).replace(/\s/g, "") === phone) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        if (c.name && !rows[idx][1]) sheet.getRange(idx + 2, 2).setValue(c.name);
        return {
          customer_id: String(rows[idx][0]),
          name: String(rows[idx][1] || ""),
          phone,
          points: parseFloat(rows[idx][3]) || 0,
          is_new: false
        };
      }
      var custId = _custId();
      sheet.appendRow([custId, String(c.name || ""), phone, 0, /* @__PURE__ */ new Date()]);
      return {
        customer_id: custId,
        name: String(c.name || ""),
        phone,
        points: 0,
        is_new: true
      };
    }
    function _addPoints(phone, pts) {
      if (!pts) return;
      var sheet = _sheet(SN.CUSTOMERS);
      var data = sheet.getDataRange().getValues();
      var rows = data.slice(1);
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][2]).replace(/\s/g, "") === String(phone).replace(/\s/g, "")) {
          sheet.getRange(i + 2, 4).setValue(Math.max(0, (parseFloat(rows[i][3]) || 0) + pts));
          return;
        }
      }
    }
    var WEB_COUPONS = { SEVENDAY10: 0.1 };
    function _priceIndex() {
      var idx = {}, VM = _variantMap();
      _allProducts().forEach(function(p) {
        idx[String(p.sku).trim().toLowerCase()] = { sku: p.sku, name: p.name, price: Number(p.price_thb) || 0 };
        (VM[String(p.sku).trim().toLowerCase()] || []).forEach(function(v) {
          var k = String(v.sku || "").trim().toLowerCase();
          if (k) idx[k] = { sku: v.sku, name: p.name + ([v.color, v.size].filter(Boolean).length ? " (" + [v.color, v.size].filter(Boolean).join(" / ") + ")" : ""), price: Number(v.price) || Number(p.price_thb) || 0 };
        });
      });
      return idx;
    }
    function _ptsCutover() {
      var pr = PropertiesService.getScriptProperties(), v = pr.getProperty("PTS_ON_COMPLETE_SINCE");
      if (!v) {
        v = String(Date.now());
        pr.setProperty("PTS_ON_COMPLETE_SINCE", v);
      }
      return Number(v);
    }
    async function createSale(body) {
      var items = body.items;
      var cust = body.customer;
      if (!items || !items.length) throw new Error("items required");
      if (items.length > 30) throw new Error("ສິນຄ້າໃນກະຕ່າຫຼາຍເກີນໄປ");
      if (!cust || !cust.phone) throw new Error("customer.phone required");
      if (String(cust.phone).replace(/\D/g, "").length < 8) throw new Error("ເບີໂທບໍ່ຖືກຕ້ອງ");
      var idx = _priceIndex(), coupon = String(body.coupon || "").trim().toUpperCase();
      var disc = WEB_COUPONS[coupon] || 0;
      items = items.map(function(it) {
        var p = idx[String(it.sku || "").trim().toLowerCase()];
        if (!p) throw new Error("ບໍ່ພົບສິນຄ້າ " + String(it.sku || "") + " — ກະລຸນາລົບອອກຈາກກະຕ່າ");
        return { sku: p.sku, name: p.name, qty: Math.max(1, Math.min(50, parseInt(it.qty) || 1)), price_thb: Math.round(p.price * (1 - disc)) };
      });
      _ptsCutover();
      if (disc) body.notes = [String(body.notes || "").replace(/ລະຫັດສ່ວນຫຼຸດ: \S+/, "").replace(/^\s*\|\s*|\s*\|\s*$/g, ""), "ລະຫັດສ່ວນຫຼຸດ: " + coupon].filter(Boolean).join(" | ");
      var now = /* @__PURE__ */ new Date();
      var curr = (body.currency || "THB").toUpperCase();
      var totalThb = 0, billId, custRec;
      if (SB_WEB_.on()) {
        var SO = await SB_WEB_.rpc("web_order_create", { p: {
          request_id: String(body.request_id || "") || "WEB-" + Utilities.getUuid(),
          customer: { name: String(cust.name || ""), phone: String(cust.phone), email: String(cust.email || "") },
          items: items.map(function(i) {
            return { sku: i.sku, qty: i.qty };
          }),
          coupon: disc ? coupon : "",
          coupon_rate: disc,
          payment_method: String(body.payment_method || ""),
          delivery_method: String(body.delivery_method || ""),
          notes: String(body.notes || ""),
          currency: curr
        } });
        clearProductCache();
        billId = SO.bill_id;
        totalThb = Number(SO.total_thb) || 0;
        custRec = { customer_id: SO.customer_id };
        if (SO.items && SO.items.length) items = SO.items.map(function(i) {
          return { sku: i.sku, name: i.name, qty: Number(i.qty) || 1, price_thb: Number(i.price_thb) || 0 };
        });
        if (SO.repeated) {
          var rp = _prices(totalThb);
          return {
            bill_id: billId,
            status: "completed",
            customer_id: custRec.customer_id,
            total_thb: rp.thb,
            total_lak: rp.lak,
            total_usd: rp.usd,
            items_count: items.length,
            created_at: now.toISOString()
          };
        }
      } else {
        custRec = await upsertCustomer({ customer: cust });
        var sheet = _sheet(SN.SALES);
        billId = _billId();
        items.forEach(function(item) {
          var price = item.price_thb;
          var qty = item.qty;
          var total = price * qty;
          totalThb += total;
          sheet.appendRow([
            billId,
            now,
            String(item.sku || ""),
            String(item.name || ""),
            qty,
            price,
            total,
            body.payment_method || "เงินสด",
            curr,
            "",
            "",
            "",
            custRec.customer_id
          ]);
        });
      }
      var prices = _prices(totalThb);
      clearProductCache();
      _inboxAdd({
        id: billId,
        type: "order",
        name: cust.name,
        phone: cust.phone,
        email: cust.email,
        total: totalThb,
        details: items.map(function(i) {
          return i.name + " (" + i.sku + ") ×" + (i.qty || 1);
        }).join("\n"),
        payment: body.payment_method,
        delivery: body.delivery_method,
        notes: body.notes
      });
      _notify("ຄຳສັ່ງຊື້ໃໝ່ " + billId, [
        "ຄຳສັ່ງຊື້ໃໝ່ຈາກເວັບໄຊ",
        "",
        "Bill: " + billId,
        "ລູກຄ້າ: " + (cust.name || "-") + "  ໂທ: " + cust.phone,
        "ອີເມວ: " + (cust.email || "-"),
        "ຊຳລະ: " + (body.payment_method || "-"),
        "ຮັບສິນຄ້າ: " + (body.delivery_method || "-"),
        "",
        "ລາຍການ:"
      ].concat(items.map(function(i) {
        return "  - " + i.name + " (" + i.sku + ") x" + i.qty + " = ฿" + i.price_thb * i.qty;
      })).concat(["", "ລວມ: ฿" + prices.thb + " / ₭" + prices.lak, "ໝາຍເຫດ: " + (body.notes || "-")]));
      return {
        bill_id: billId,
        status: "completed",
        customer_id: custRec.customer_id,
        total_thb: prices.thb,
        total_lak: prices.lak,
        total_usd: prices.usd,
        items_count: items.length,
        created_at: now.toISOString()
      };
    }
    async function createRepair(body) {
      if (body && body.queue) return await _qBook(body, "เว็บไซต์", false);
      return await _createRepairJob(body, "website");
    }
    async function _createRepairJob(body, source, qinfo) {
      var cust = body.customer;
      var bike = body.bike;
      if (!cust || !cust.phone) throw new Error("customer.phone required");
      if (!bike || !bike.model) throw new Error("bike.model required");
      var jobId = _repairId();
      var now = /* @__PURE__ */ new Date();
      var bikeTxt = String((bike.brand ? bike.brand + " " : "") + bike.model);
      var q = body.queue, qid = null;
      if (SB_WEB_.on()) {
        var RJ = await SB_WEB_.rpc("web_repair_create", { p: {
          job_id: jobId,
          customer: { name: String(cust.name || ""), phone: String(cust.phone || ""), email: String(cust.email || "") },
          bike: bikeTxt,
          symptoms: String(body.symptoms || ""),
          mechanic: String(body.mechanic || ""),
          notes: String(body.notes || ""),
          queue: qinfo || null
        } });
        qid = RJ.queue_id || null;
      } else {
        var cust_id = "";
        try {
          cust_id = (await upsertCustomer({ customer: cust })).customer_id || "";
        } catch (e) {
          Logger.log("upsertCustomer: " + e.message);
        }
        var sheet = _sheet(SN.REPAIR);
        sheet.appendRow([
          jobId,
          now,
          String(cust.name || ""),
          String(cust.phone || ""),
          bikeTxt,
          String(body.symptoms || ""),
          "รับเรื่อง",
          String(body.mechanic || ""),
          0,
          0,
          0,
          "",
          "",
          String(body.notes || ""),
          cust_id,
          false
        ]);
      }
      _inboxAdd({
        id: jobId,
        type: /^Film Wrap/.test(String(body.symptoms || "")) ? "film" : "booking",
        name: cust.name,
        phone: cust.phone,
        details: bikeTxt + "\n" + String(body.symptoms || ""),
        notes: body.notes
      });
      _notify("ຈອງ Workshop ໃໝ່ " + jobId, [
        "ຈອງຄິວ / ສ້ອມ ຈາກ" + (source === "แอดมิน" ? "ແອັດມິນ" : "ເວັບໄຊ"),
        "",
        "Job: " + jobId,
        "ລູກຄ້າ: " + (cust.name || "-") + "  ໂທ: " + cust.phone,
        "ຈັກຍານ: " + bikeTxt,
        "ລາຍການ: " + (body.symptoms || "-"),
        "ໝາຍເຫດ: " + (body.notes || "-")
      ]);
      var res = {
        job_id: jobId,
        status: "รับเรื่อง",
        bike: bikeTxt,
        created_at: now.toISOString(),
        note: q ? "ຢືນຢັນຄິວແລ້ວ" : "ช่าง Sevenday จะติดต่อยืนยันภายใน 2 ชม."
      };
      if (qid) res.queue_id = qid;
      return res;
    }
    async function createBooking(body) {
      var cust = body.customer;
      if (!cust || !cust.phone) throw new Error("customer.phone required");
      if (SB_WEB_.on()) {
        var BK = await SB_WEB_.rpc("web_booking_create", { p: {
          customer: { name: String(cust.name || ""), phone: String(cust.phone), email: String(cust.email || "") },
          sku: String(body.sku || ""),
          product_name: String(body.product_name || ""),
          deposit: parseFloat(body.deposit) || 0,
          date: String(body.date || ""),
          note: String(body.note || ""),
          request_id: String(body.request_id || "")
        } });
        if (!BK.repeated) _notify("ຈອງສິນຄ້າໃໝ່ " + BK.booking_id, [
          "Booking: " + BK.booking_id,
          "ລູກຄ້າ: " + (cust.name || "-") + "  ໂທ: " + cust.phone,
          "ສິນຄ້າ: " + (body.product_name || "") + " (" + (body.sku || "") + ")",
          "ວັນທີ: " + (body.date || "-"),
          "ໝາຍເຫດ: " + (body.note || "-")
        ]);
        return { booking_id: BK.booking_id, status: "ยืนยัน", created_at: (/* @__PURE__ */ new Date()).toISOString(), note: "Sevenday จะติดต่อยืนยันภายใน 2 ชม." };
      }
      var custRec = await upsertCustomer({ customer: cust });
      var sheet = _sheet(SN.BOOKINGS);
      var bkId = _bookingId();
      var now = /* @__PURE__ */ new Date();
      var row = new Array(25).fill("");
      row[0] = bkId;
      row[1] = custRec.customer_id;
      row[2] = String(cust.name || "");
      row[3] = String(cust.phone || "");
      row[4] = String(body.sku || "");
      row[5] = String(body.product_name || "");
      row[8] = parseFloat(body.deposit) || 0;
      row[14] = body.date || "";
      row[15] = String(body.note || "");
      row[16] = "ยืนยัน";
      row[19] = now;
      sheet.appendRow(row);
      _notify("ຈອງສິນຄ້າໃໝ່ " + bkId, [
        "Booking: " + bkId,
        "ລູກຄ້າ: " + (cust.name || "-") + "  ໂທ: " + cust.phone,
        "ສິນຄ້າ: " + (body.product_name || "") + " (" + (body.sku || "") + ")",
        "ວັນທີ: " + (body.date || "-"),
        "ໝາຍເຫດ: " + (body.note || "-")
      ]);
      return {
        booking_id: bkId,
        status: "ยืนยัน",
        created_at: now.toISOString(),
        note: "Sevenday จะติดต่อยืนยันภายใน 2 ชม."
      };
    }
    async function createFilmRequest(body) {
      var cust = body.customer;
      if (!cust || !cust.phone) throw new Error("customer.phone required");
      var symptoms = [
        "Film Wrap Request",
        "Package: " + (body.package || ""),
        "สี: " + (body.color_name || ""),
        "Finish: " + (body.finish || "")
      ].join(" | ");
      return await createRepair({
        customer: cust,
        bike: body.bike || { model: "ไม่ระบุ" },
        symptoms,
        notes: body.notes || ""
      });
    }
    return {
      handleGet: async function(e) {
        if (!_auth(e)) return _err(401, "Unauthorized");
        var action = (e.parameter.action || "").trim();
        try {
          switch (action) {
            case "getProducts":
              return _ok(await getProducts(e.parameter));
            case "getProduct":
              return _ok(await getProduct(e.parameter.sku));
            case "getStock":
              return _ok(await checkStock(e.parameter));
            case "checkStock":
              return _ok(await checkStockMany(e.parameter));
            // [ຄວາມປອດໄພ] ປິດ getCustomer — ເມື່ອກ່ອນໃຜກໍຄົ້ນຊື່/ແຕ້ມລູກຄ້າດ້ວຍເບີໂທໄດ້
            case "getSettings":
              return _ok(await getSettings());
            case "getSiteConfig":
              return _ok(await getSiteConfigPublic());
            case "getServices":
              return _ok(await getServices());
            case "exportCatalog":
              return _ok(await exportCatalog());
            case "getRepairSlots":
              return _ok(await getRepairSlots(e.parameter));
            case "ping":
              return _ok(await {
                status: "ok",
                version: "v1.6",
                source: SB_WEB_.on() ? "supabase" : "sheets",
                ts: (/* @__PURE__ */ new Date()).toISOString()
              });
            default:
              return _err(400, "Unknown action: " + action);
          }
        } catch (ex) {
          return _err(500, ex.message);
        }
      },
      handlePost: async function(e) {
        if (!_auth(e)) return _err(401, "Unauthorized");
        var body;
        try {
          body = JSON.parse(e.postData.contents);
        } catch (_) {
          return _err(400, "Invalid JSON");
        }
        var action = (body.action || "").trim();
        try {
          switch (action) {
            case "createSale":
              return _ok(await createSale(body));
            case "createRepair":
              return _ok(await createRepair(body));
            case "createBooking":
              return _ok(await createBooking(body));
            // [ຄວາມປອດໄພ] ປິດ upsertCustomer ຈາກພາຍນອກ (ໃຊ້ພາຍໃນເທົ່ານັ້ນ)
            case "filmRequest":
              return _ok(await createFilmRequest(body));
            case "loginCustomer":
              return _ok(await loginCustomer(body));
            case "adminLogin":
              return _ok(await adminLogin(body));
            case "adminList":
              return _ok(await adminList(body));
            case "adminUpdate":
              return _ok(await adminUpdate(body));
            case "saveSiteConfig":
              return _ok(await saveSiteConfig(body));
            case "mediaList":
              return _ok(await mediaList(body));
            case "mediaSave":
              return _ok(await mediaSave(body));
            case "mediaUpload":
              return _ok(await mediaUpload(body));
            case "resolveVideo":
              return _ok(await resolveVideo(body));
            case "queueAdmin":
              return _ok(await queueAdmin(body));
            case "queueSave":
              return _ok(await queueSave(body));
            case "queueBlock":
              return _ok(await queueBlock(body));
            case "queueConfig":
              return _ok(await queueConfig(body));
            case "registerCustomer":
              return _ok(await registerCustomer(body));
            case "getCustomerOrders":
              return _ok(await getCustomerOrders(body));
            default:
              return _err(400, "Unknown action: " + action);
          }
        } catch (ex) {
          return _err(500, ex.message);
        }
      },
      syncImages,
      snapshotPosImages: function() {
        syncImages();
        return _snapshotPosImages();
      },
      hashPw: function(p) {
        return _hashPw(p);
      },
      syncCategories,
      hashAllPasswords,
      clearCache: clearProductCache,
      warmCache: function() {
        clearProductCache();
        return _allProducts().length;
      }
    };
  }();
  var _EVT_ = /* @__PURE__ */ function() {
    function _evtSB() {
      return SB_WEB_.evtOn();
    }
    var _GLS = __LockService;
    var LockService2 = { getScriptLock: function() {
      var l = _GLS.getScriptLock();
      return {
        tryLock: function(ms) {
          var ok = l.tryLock(ms);
          if (ok && _evtSB()) EVT_STORE_.invalidate();
          return ok;
        },
        waitLock: function(ms) {
          l.waitLock(ms);
          if (_evtSB()) EVT_STORE_.invalidate();
        },
        hasLock: function() {
          return l.hasLock();
        },
        releaseLock: function() {
          try {
            if (_evtSB()) EVT_STORE_.flush();
          } finally {
            l.releaseLock();
          }
        }
      };
    } };
    var EVT_SHEET_ID = "1Oqiqr5ludqoHHsKRnZi-Bi_GcAkV6MpOOdYlXDIbLLs";
    var POS_SHEET_ID = "1dd-tdH6KwrXQOP7bSU9xBU982VsqbyR-CKwLm2AToho";
    var WEB_SECRET = "SDdMc3wNjJEevs60n2oMQeGnuI";
    var NOTIFY_EMAIL = "Lock.xayasing2021@gmail.com";
    var SITE_URL = "https://sevendaybike.com/";
    var SLIP_FOLDER = "Sevenday Event Slips";
    var SN = {
      EVENTS: "Events",
      CATEGORIES: "EventCategories",
      PARTICIPANTS: "EventParticipants",
      REGISTRATIONS: "EventRegistrations",
      REG_ITEMS: "EventRegistrationItems",
      PAYMENTS: "EventPayments",
      RESULTS: "EventResults",
      AUDIT: "EventAuditLog",
      // Audit log ທຸກ Admin action ສຳຄັນ
      CUSTOMERS: "Customers",
      // ໃຊ້ຊີດລູກຄ້າເດີມ — ຫ້າມສ້າງໃໝ່
      PRODUCTS: "Products"
      // ໃຊ້ຊີດສິນຄ້າເດີມ — ຫ້າມສ້າງໃໝ່
    };
    var HEADS = {
      EVENTS: [
        "event_id",
        "event_code",
        "event_name",
        "event_type",
        "description",
        "cover_image",
        "event_date",
        "start_time",
        "end_time",
        "location",
        "latitude",
        "longitude",
        "registration_open",
        "registration_close",
        "status",
        "organizer",
        "contact_phone",
        "contact_email",
        "terms_url",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by"
      ],
      CATEGORIES: [
        "category_id",
        "event_id",
        "category_code",
        "category_name",
        "description",
        "distance",
        "price_lak",
        "capacity",
        "registered_count",
        "min_age",
        "max_age",
        "gender_rule",
        "status",
        "created_at",
        "updated_at",
        "early_price_lak",
        "early_until",
        "early_quota"
      ],
      PARTICIPANTS: [
        "participant_id",
        "customer_id",
        "first_name",
        "last_name",
        "nickname",
        "gender",
        "date_of_birth",
        "nationality",
        "phone",
        "email",
        "emergency_name",
        "emergency_phone",
        "bike_brand",
        "bike_model",
        "bike_wheel_size",
        "jersey_size",
        "medical_note",
        "created_at",
        "updated_at"
      ],
      REGISTRATIONS: [
        "registration_id",
        "reg_number",
        "event_id",
        "participant_id",
        "category_id",
        "bib_number",
        "reg_date",
        "subtotal",
        "discount",
        "total",
        "payment_status",
        "reg_status",
        "checkin_status",
        "checkin_time",
        "checked_by",
        "qr_token",
        "notes",
        "created_at",
        "updated_at"
      ],
      REG_ITEMS: [
        "item_id",
        "registration_id",
        "product_id",
        "product_name",
        "quantity",
        "unit_price",
        "total",
        "created_at"
      ],
      PAYMENTS: [
        "payment_id",
        "registration_id",
        "payment_reference",
        "amount",
        "payment_method",
        "payment_date",
        "proof_image_id",
        "status",
        "verified_by",
        "verified_at",
        "note",
        "created_at"
      ],
      RESULTS: [
        "result_id",
        "registration_id",
        "category_id",
        "bib_number",
        "start_time",
        "finish_time",
        "elapsed_time",
        "overall_rank",
        "category_rank",
        "status",
        "created_at",
        "updated_at"
      ],
      AUDIT: [
        "log_id",
        "timestamp",
        "action",
        "admin_id",
        "event_id",
        "registration_id",
        "result",
        "detail"
      ]
    };
    var HEAD_KEY = {
      "Events": "EVENTS",
      "EventCategories": "CATEGORIES",
      "EventParticipants": "PARTICIPANTS",
      "EventRegistrations": "REGISTRATIONS",
      "EventRegistrationItems": "REG_ITEMS",
      "EventPayments": "PAYMENTS",
      "EventResults": "RESULTS",
      "EventAuditLog": "AUDIT"
    };
    var EVT_SHEETS = [
      "Events",
      "EventCategories",
      "EventParticipants",
      "EventRegistrations",
      "EventRegistrationItems",
      "EventPayments",
      "EventResults",
      "EventAuditLog"
    ];
    function _ensureSheet(name) {
      var isEvt = EVT_SHEETS.indexOf(name) > -1;
      if (isEvt && _evtSB()) return EVT_STORE_.sheet(name, HEADS[HEAD_KEY[name]]);
      var ss = SpreadsheetApp.openById(isEvt ? EVT_SHEET_ID : POS_SHEET_ID);
      var sh = ss.getSheetByName(name);
      if (!sh && isEvt) {
        sh = ss.insertSheet(name);
        var h = HEADS[HEAD_KEY[name]];
        if (h) {
          sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight("bold").setBackground("#1a1a1a").setFontColor("#ffffff");
          sh.setFrozenRows(1);
          sh.setColumnWidths(1, h.length, 150);
        }
        Logger.log("ສ້າງຊີດໃໝ່ (Events DB): " + name);
      } else if (!sh) {
        throw new Error("Sheet not found in POS DB: " + name);
      } else if (isEvt && !_hdrOk[name]) {
        var wantH = HEADS[HEAD_KEY[name]] || [];
        if (wantH.length && sh.getLastRow() === 0) {
          sh.getRange(1, 1, 1, wantH.length).setValues([wantH]).setFontWeight("bold").setBackground("#1a1a1a").setFontColor("#ffffff");
          sh.setFrozenRows(1);
        } else if (wantH.length) {
          var first = String(sh.getRange(1, 1).getValue()).trim();
          if (first !== wantH[0] && /^[A-Z]{2,4}-[A-Z0-9]/.test(first)) {
            var r1 = sh.getRange(1, 1, 1, wantH.length).getValues()[0].map(function(v, c2) {
              return String(v) === wantH[c2] ? "" : v;
            });
            sh.getRange(1, 1, 1, wantH.length).setValues([r1]);
            sh.insertRowBefore(1);
            sh.getRange(1, 1, 1, wantH.length).setValues([wantH]).setFontWeight("bold").setBackground("#1a1a1a").setFontColor("#ffffff");
            sh.setFrozenRows(1);
            Logger.log("ໃສ່ຫົວຕາຕະລາງຄືນ: " + name);
          }
        }
        var want = HEADS[HEAD_KEY[name]] || [], have = sh.getRange(1, 1, 1, Math.max(1, want.length)).getValues()[0];
        var missing = [];
        for (var c = 0; c < want.length; c++) if (!String(have[c] || "").trim()) missing.push(c);
        if (missing.length && missing[0] >= 1) {
          missing.forEach(function(c2) {
            sh.getRange(1, c2 + 1).setValue(want[c2]).setFontWeight("bold").setBackground("#1a1a1a").setFontColor("#ffffff");
          });
          Logger.log("ເພີ່ມຫົວຖັນ " + name + ": " + missing.map(function(c2) {
            return want[c2];
          }).join(", "));
        }
        _hdrOk[name] = true;
      }
      return sh;
    }
    var _hdrOk = {};
    function _rows(name) {
      var sh = _ensureSheet(name);
      var data = sh.getDataRange().getValues();
      return { headers: data[0], rows: data.slice(1), sheet: sh };
    }
    function _posRows(name) {
      var ss = SpreadsheetApp.openById(POS_SHEET_ID);
      var sh = ss.getSheetByName(name);
      if (!sh) throw new Error("POS sheet not found: " + name);
      var data = sh.getDataRange().getValues();
      return { headers: data[0], rows: data.slice(1), sheet: sh };
    }
    function _auth(e) {
      if (e.parameter && e.parameter.secret === WEB_SECRET) return true;
      if (e.pathInfo && e.pathInfo.trim() === WEB_SECRET) return true;
      try {
        if (e.postData) {
          var b = JSON.parse(e.postData.contents);
          if (b.secret === WEB_SECRET) return true;
        }
      } catch (_) {
      }
      return false;
    }
    function _sessionKey() {
      var pr = PropertiesService.getScriptProperties(), k = pr.getProperty("SESSION_KEY");
      if (!k) {
        k = Utilities.getUuid() + Utilities.getUuid();
        pr.setProperty("SESSION_KEY", k);
      }
      return k;
    }
    function _readToken(token) {
      try {
        var t = String(token || "").split(".");
        if (t.length !== 2) return null;
        var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(t[0])).getDataAsString();
        var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _sessionKey()));
        if (sig !== t[1]) return null;
        var p = payload.split("|");
        if (Date.now() > Number(p[1])) return null;
        return p[0];
      } catch (e) {
        return null;
      }
    }
    function _isAdmin(token) {
      try {
        var t = String(token || "").split(".");
        var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(t[0])).getDataAsString();
        return payload.indexOf("ADMIN|") === 0 && Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _sessionKey())) === t[1] && Date.now() < Number(payload.split("|")[1]);
      } catch (e) {
        return false;
      }
    }
    function _uuid8() {
      return Utilities.getUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
    }
    function _eventId() {
      return "EV-" + _uuid8();
    }
    function _catId() {
      return "EC-" + _uuid8();
    }
    function _partId() {
      return "EP-" + _uuid8();
    }
    function _payId() {
      return "PAY-" + _uuid8();
    }
    function _itemId() {
      return "EI-" + _uuid8();
    }
    function _resultId() {
      return "ER-" + _uuid8();
    }
    function _qrToken() {
      return Utilities.getUuid().replace(/-/g, "");
    }
    function _regNumber(eventCode, seq) {
      return "SD-" + String(eventCode || "EVT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) + "-" + String(seq).padStart(6, "0");
    }
    function _regId(eventCode, seq) {
      return "REG-" + String(eventCode || "EVT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) + "-" + String(seq).padStart(6, "0");
    }
    function _notify(subject, lines) {
      if (_evtSB()) EVT_STORE_.flush();
      try {
        MailApp.sendEmail(NOTIFY_EMAIL, "[Sevenday Events] " + subject, lines.join("\n"));
      } catch (e) {
        Logger.log("notify error: " + e.message);
      }
    }
    function _ok(data) {
      if (_evtSB()) EVT_STORE_.flush();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data, ts: (/* @__PURE__ */ new Date()).toISOString() })).setMimeType(ContentService.MimeType.JSON);
    }
    function _err(code, msg) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg, code })).setMimeType(ContentService.MimeType.JSON);
    }
    function _findRow(sheet, colIndex, value) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) if (String(data[i][colIndex]) === String(value)) return { row: i + 1, data: data[i] };
      return null;
    }
    function _nextSeq(sheetName, eventIdColIdx, eventId) {
      var data = _rows(sheetName).rows;
      var count = 0;
      data.forEach(function(r) {
        if (String(r[eventIdColIdx]) === String(eventId)) count++;
      });
      return count + 1;
    }
    function setupEventSheets2() {
      var created = [];
      EVT_SHEETS.forEach(function(name) {
        var ss = SpreadsheetApp.openById(EVT_SHEET_ID);
        if (!ss.getSheetByName(name)) {
          _ensureSheet(name);
          created.push(name);
        } else Logger.log("ມີຢູ່ແລ້ວ (Events DB): " + name);
      });
      return created.length ? "ສ້າງຊີດໃໝ່ໃນ Events DB: " + created.join(", ") : "ທຸກຊີດ Events ມີຢູ່ແລ້ວ";
    }
    function createEvent(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var name = String(body.event_name || "").trim();
      var code = String(body.event_code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!name || !code) throw new Error("event_name and event_code required");
      var E = _rows(SN.EVENTS);
      for (var i = 0; i < E.rows.length; i++) if (String(E.rows[i][1]).toUpperCase() === code) return { ok: false, error: "event_code ນີ້ມີແລ້ວ: " + code };
      var evId = _eventId(), now = /* @__PURE__ */ new Date();
      var adminId = body.admin_id || "admin";
      E.sheet.appendRow([
        evId,
        code,
        name,
        String(body.event_type || "CYCLING"),
        String(body.description || ""),
        String(body.cover_image || ""),
        body.event_date ? new Date(body.event_date) : "",
        body.start_time ? "'" + String(body.start_time) : "",
        body.end_time ? "'" + String(body.end_time) : "",
        String(body.location || ""),
        parseFloat(body.latitude) || "",
        parseFloat(body.longitude) || "",
        body.registration_open ? new Date(body.registration_open) : "",
        body.registration_close ? new Date(body.registration_close) : "",
        "DRAFT",
        String(body.organizer || "Sevenday Bike"),
        "'" + String(body.contact_phone || "020 9884 4344"),
        String(body.contact_email || NOTIFY_EMAIL),
        String(body.terms_url || ""),
        now,
        now,
        adminId,
        adminId
      ]);
      Logger.log("ສ້າງ Event: " + evId + " (" + code + ")");
      return { event_id: evId, event_code: code, event_name: name, status: "DRAFT", created_at: now.toISOString() };
    }
    function updateEventStatus(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      var status = String(body.status || "");
      var allowed = ["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "EVENT_FINISHED", "CANCELLED"];
      if (!evId || allowed.indexOf(status) < 0) throw new Error("event_id and valid status required");
      var sh = _ensureSheet(SN.EVENTS);
      var found = _findRow(sh, 0, evId);
      if (!found) throw new Error("Event not found: " + evId);
      sh.getRange(found.row, 15).setValue(status);
      sh.getRange(found.row, 21).setValue(/* @__PURE__ */ new Date());
      sh.getRange(found.row, 23).setValue(body.admin_id || "admin");
      _audit("UPDATE_EVENT_STATUS", { admin_id: body.admin_id, event_id: evId }, "", "OK", { status });
      return { ok: true, event_id: evId, status };
    }
    function updateEvent(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      if (!evId) throw new Error("event_id required");
      var sh = _ensureSheet(SN.EVENTS);
      var found = _findRow(sh, 0, evId);
      if (!found) throw new Error("Event not found: " + evId);
      var row = found.row;
      var map = {
        event_name: 3,
        event_type: 4,
        description: 5,
        cover_image: 6,
        event_date: 7,
        start_time: 8,
        end_time: 9,
        location: 10,
        latitude: 11,
        longitude: 12,
        registration_open: 13,
        registration_close: 14,
        organizer: 16,
        contact_phone: 17,
        contact_email: 18,
        terms_url: 19
      };
      Object.keys(map).forEach(function(k) {
        if (body[k] !== void 0) {
          var val = body[k];
          if (["event_date", "registration_open", "registration_close"].indexOf(k) > -1) val = val ? new Date(val) : "";
          else if (["start_time", "end_time", "contact_phone"].indexOf(k) > -1 && val) val = "'" + String(val);
          sh.getRange(row, map[k]).setValue(val);
        }
      });
      sh.getRange(row, 21).setValue(/* @__PURE__ */ new Date());
      sh.getRange(row, 23).setValue(body.admin_id || "admin");
      return { ok: true, event_id: evId, updated: Object.keys(map).filter(function(k) {
        return body[k] !== void 0;
      }) };
    }
    var TZ = "Asia/Vientiane";
    function _ymd(v) {
      return v ? Utilities.formatDate(new Date(v), TZ, "yyyy-MM-dd") : "";
    }
    function _hm(v) {
      if (!v) return "";
      if (v instanceof Date) return Utilities.formatDate(v, TZ, "HH:mm");
      return String(v);
    }
    function _digits(s) {
      return String(s || "").replace(/\D/g, "");
    }
    function _samePhone(a, b) {
      var x = _digits(a).slice(-8), y = _digits(b).slice(-8);
      return x.length >= 7 && x === y;
    }
    function _txt(v) {
      v = String(v == null ? "" : v).trim();
      return v ? "'" + v : "";
    }
    function _closeAt(v) {
      if (!v) return Infinity;
      var d = new Date(v);
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return d.getTime() + 17 * 3600 * 1e3 - 1;
      return d.getTime();
    }
    function _regState(ev) {
      var st = String(ev[14]).toUpperCase(), now = Date.now();
      if (st !== "REGISTRATION_OPEN") return st === "PUBLISHED" ? "SOON" : "CLOSED";
      if (ev[12] && now < new Date(ev[12]).getTime() - 7 * 3600 * 1e3) return "SOON";
      if (now > _closeAt(ev[13])) return "CLOSED";
      return "OPEN";
    }
    function _earlyCfg(r) {
      var reg = parseFloat(r[6]) || 0, ep = r[15], until = r[16];
      if (ep === "" || ep === null || ep === void 0 || !until) return null;
      ep = parseFloat(ep);
      if (isNaN(ep) || ep < 0 || ep >= reg) return null;
      return { price_lak: ep, until, quota: parseInt(r[17]) || 0 };
    }
    function _earlyUsed(regRows) {
      var used = {};
      (regRows || _rows(SN.REGISTRATIONS).rows).forEach(function(x) {
        if (x[0] && (parseFloat(x[8]) || 0) > 0 && String(x[11]).toUpperCase() !== "CANCELLED") used[String(x[4])] = (used[String(x[4])] || 0) + 1;
      });
      return used;
    }
    function _priceNow(r, used) {
      var reg = parseFloat(r[6]) || 0, e = _earlyCfg(r);
      if (!e || Date.now() > _closeAt(e.until)) return { price: reg, regular: reg, early: null };
      var n = used && used[String(r[0])] || 0;
      if (e.quota && n >= e.quota) return { price: reg, regular: reg, early: null };
      return { price: e.price_lak, regular: reg, early: { price_lak: e.price_lak, until: _ymd(e.until), quota: e.quota, remaining: e.quota ? e.quota - n : null } };
    }
    function _catPublic(r, used) {
      var cap = parseInt(r[7]) || 0, reg = parseInt(r[8]) || 0, pn = _priceNow(r, used), e = _earlyCfg(r);
      return {
        category_id: r[0],
        event_id: r[1],
        category_code: r[2],
        category_name: r[3],
        description: r[4],
        distance: r[5],
        price_lak: parseFloat(r[6]) || 0,
        current_price_lak: pn.price,
        early_bird: pn.early,
        early_price_lak: e ? e.price_lak : "",
        early_until: e ? _ymd(e.until) : "",
        early_quota: e ? e.quota : "",
        capacity: cap,
        registered_count: reg,
        remaining: cap ? Math.max(0, cap - reg) : null,
        min_age: r[9],
        max_age: r[10],
        gender_rule: r[11] || "ALL",
        status: r[12] || "ACTIVE"
      };
    }
    function _evPublic(ev) {
      return {
        event_id: ev[0],
        event_code: ev[1],
        event_name: ev[2],
        event_type: ev[3],
        description: ev[4],
        cover_image: ev[5],
        event_date: _ymd(ev[6]),
        start_time: _hm(ev[7]),
        end_time: _hm(ev[8]),
        location: ev[9],
        latitude: ev[10],
        longitude: ev[11],
        registration_open: _ymd(ev[12]),
        registration_close: _ymd(ev[13]),
        status: ev[14],
        registration_state: _regState(ev),
        organizer: ev[15],
        contact_phone: String(ev[16] || ""),
        contact_email: ev[17],
        terms_url: ev[18]
      };
    }
    function getEvents(params) {
      var E = _rows(SN.EVENTS);
      var statusFilter = String(params.status || "").toUpperCase();
      var typeFilter = String(params.event_type || "").toUpperCase();
      var agg = {}, used = _earlyUsed();
      _rows(SN.CATEGORIES).rows.forEach(function(r) {
        if (!r[0] || String(r[12] || "ACTIVE").toUpperCase() !== "ACTIVE") return;
        var k = String(r[1]), a = agg[k] || (agg[k] = { price_from: null, price_to: 0, capacity: 0, registered: 0, unlimited: false, categories: 0, early: null });
        var pn = _priceNow(r, used), pr = pn.price, cap = parseInt(r[7]) || 0;
        if (pn.early && (!a.early || pn.early.until < a.early)) a.early = pn.early.until;
        a.price_from = a.price_from === null ? pr : Math.min(a.price_from, pr);
        a.price_to = Math.max(a.price_to, pr);
        if (cap) a.capacity += cap;
        else a.unlimited = true;
        a.registered += parseInt(r[8]) || 0;
        a.categories++;
      });
      var list = E.rows.filter(function(r) {
        return r[0];
      }).filter(function(r) {
        var st = String(r[14]).toUpperCase();
        if (statusFilter && st !== statusFilter) return false;
        if (typeFilter && String(r[3]).toUpperCase() !== typeFilter) return false;
        if (!params.admin && ["DRAFT", "CANCELLED"].indexOf(st) > -1) return false;
        return true;
      }).map(function(r) {
        var o = _evPublic(r), a = agg[String(r[0])];
        o.price_from = a ? a.price_from : null;
        o.price_to = a ? a.price_to : null;
        o.early_bird_until = a && a.early ? a.early : null;
        o.categories_count = a ? a.categories : 0;
        o.capacity = a && !a.unlimited ? a.capacity : null;
        o.registered = a ? a.registered : 0;
        o.remaining = o.capacity === null ? null : Math.max(0, o.capacity - o.registered);
        o.results_published = _resPublished(String(r[0]));
        return o;
      });
      list.sort(function(a, b) {
        return String(a.event_date).localeCompare(String(b.event_date));
      });
      return { events: list, total: list.length };
    }
    function getEvent(params) {
      var evId = String(params.event_id || "");
      var evCode = String(params.event_code || "").toUpperCase();
      if (!evId && !evCode) throw new Error("event_id or event_code required");
      var E = _rows(SN.EVENTS);
      var ev = null;
      for (var i = 0; i < E.rows.length; i++) {
        if (evId && String(E.rows[i][0]) === evId || evCode && String(E.rows[i][1]).toUpperCase() === evCode) {
          ev = E.rows[i];
          break;
        }
      }
      if (!ev) throw new Error("ບໍ່ພົບງານນີ້");
      var o = _evPublic(ev), used = _earlyUsed();
      o.categories = _rows(SN.CATEGORIES).rows.filter(function(r) {
        return r[0] && String(r[1]) === String(ev[0]);
      }).map(function(r) {
        return _catPublic(r, used);
      });
      return o;
    }
    function createCategory(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      var code = String(body.category_code || "").trim().toUpperCase();
      var name = String(body.category_name || "").trim();
      if (!evId || !code || !name) throw new Error("event_id, category_code, category_name required");
      var C = _rows(SN.CATEGORIES);
      for (var i = 0; i < C.rows.length; i++) {
        if (String(C.rows[i][1]) === evId && String(C.rows[i][2]).toUpperCase() === code) return { ok: false, error: "category_code ນີ້ມີໃນ event ນີ້ແລ້ວ" };
      }
      var catId = _catId(), now = /* @__PURE__ */ new Date();
      C.sheet.appendRow([
        catId,
        evId,
        code,
        name,
        String(body.description || ""),
        String(body.distance || ""),
        parseFloat(body.price_lak) || 0,
        parseInt(body.capacity) || 0,
        0,
        // registered_count
        parseInt(body.min_age) || "",
        parseInt(body.max_age) || "",
        String(body.gender_rule || "ALL"),
        "ACTIVE",
        now,
        now
      ].concat(_earlyVals(body, parseFloat(body.price_lak) || 0)));
      _audit("CREATE_CATEGORY", body, "", "OK", { category_id: catId, name });
      return { category_id: catId, event_id: evId, category_code: code, category_name: name, status: "ACTIVE", created_at: now.toISOString() };
    }
    function _earlyVals(body, regular) {
      var ep = body.early_price_lak, until = String(body.early_until || "").trim();
      if (ep === "" || ep === null || ep === void 0 || !until) return ["", "", ""];
      ep = parseFloat(ep);
      if (isNaN(ep) || ep < 0) throw new Error("ລາຄາ Early Bird ບໍ່ຖືກຕ້ອງ");
      if (ep >= regular) throw new Error("ລາຄາ Early Bird ຕ້ອງຕ່ຳກວ່າລາຄາປົກກະຕິ");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("ວັນສິ້ນສຸດ Early Bird ບໍ່ຖືກຕ້ອງ");
      return [ep, new Date(until), parseInt(body.early_quota) || 0];
    }
    function updateCategory(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var catId = String(body.category_id || "");
      if (!catId) throw new Error("category_id required");
      var sh = _ensureSheet(SN.CATEGORIES);
      var found = _findRow(sh, 0, catId);
      if (!found) throw new Error("Category not found: " + catId);
      var map = { category_name: 4, description: 5, distance: 6, price_lak: 7, capacity: 8, min_age: 10, max_age: 11, gender_rule: 12, status: 13 };
      Object.keys(map).forEach(function(k) {
        if (body[k] !== void 0) sh.getRange(found.row, map[k]).setValue(body[k]);
      });
      if (body.early_price_lak !== void 0 || body.early_until !== void 0) {
        var regular = body.price_lak !== void 0 ? parseFloat(body.price_lak) || 0 : parseFloat(found.data[6]) || 0;
        sh.getRange(found.row, 16, 1, 3).setValues([_earlyVals(body, regular)]);
      } else if (body.price_lak !== void 0) {
        var e0 = _earlyCfg(found.data.slice(0, 6).concat([parseFloat(body.price_lak) || 0], found.data.slice(7)));
        if (found.data[15] !== "" && found.data[15] !== void 0 && !e0) sh.getRange(found.row, 16, 1, 3).setValues([["", "", ""]]);
      }
      sh.getRange(found.row, 15).setValue(/* @__PURE__ */ new Date());
      body.event_id = String(found.data[1]);
      _audit("UPDATE_CATEGORY", body, "", "OK", { category_id: catId });
      return { ok: true, category_id: catId };
    }
    function getRegistration(params) {
      var regId = String(params.registration_id || "");
      var qrToken = String(params.qr_token || params.t || "").trim();
      if (!qrToken && !regId) throw new Error("qr_token required");
      var isAdmin = _isAdmin(params.token), custId = isAdmin ? null : _readToken(params.token);
      if (!qrToken && !isAdmin && !custId) throw new Error("ບໍ່ມີສິດເບິ່ງ");
      if (qrToken && !/^[A-Za-z0-9]{16,64}$/.test(qrToken)) throw new Error("ລິ້ງບໍ່ຖືກຕ້ອງ");
      var R = _rows(SN.REGISTRATIONS), reg = null;
      for (var i = 0; i < R.rows.length; i++) {
        var r = R.rows[i];
        if (qrToken && String(r[15]) === qrToken || !qrToken && regId && String(r[0]) === regId) {
          reg = r;
          break;
        }
      }
      if (!reg) throw new Error("ບໍ່ພົບການລົງທະບຽນ");
      var part = null;
      _rows(SN.PARTICIPANTS).rows.some(function(p) {
        if (String(p[0]) === String(reg[3])) {
          part = p;
          return true;
        }
      });
      if (!qrToken && !isAdmin && (!part || String(part[1]) !== custId)) throw new Error("ບໍ່ມີສິດເບິ່ງ");
      var ev = null, cat = null;
      _rows(SN.EVENTS).rows.some(function(e) {
        if (String(e[0]) === String(reg[2])) {
          ev = e;
          return true;
        }
      });
      _rows(SN.CATEGORIES).rows.some(function(c) {
        if (String(c[0]) === String(reg[4])) {
          cat = c;
          return true;
        }
      });
      var pays = _rows(SN.PAYMENTS).rows.filter(function(r2) {
        return r2[0] && String(r2[1]) === String(reg[0]);
      });
      pays.sort(function(a, b) {
        return new Date(a[11]) - new Date(b[11]);
      });
      var last = pays[pays.length - 1];
      var ps = String(reg[10]).toUpperCase(), rs = String(reg[11]).toUpperCase();
      return {
        registration_id: reg[0],
        reg_number: reg[1],
        event_id: reg[2],
        category_id: reg[4],
        bib_number: reg[5],
        reg_date: reg[6] ? new Date(reg[6]).toISOString() : "",
        subtotal: reg[7],
        discount: reg[8],
        total: reg[9],
        payment_status: reg[10],
        reg_status: reg[11],
        checkin_status: reg[12],
        checkin_time: reg[13] ? new Date(reg[13]).toISOString() : "",
        qr_token: reg[15],
        can_pay: rs !== "CANCELLED" && (ps === "UNPAID" || ps === "REJECTED") && (parseFloat(reg[9]) || 0) > 0,
        event: ev ? _evPublic(ev) : null,
        category: cat ? { category_id: cat[0], category_name: cat[3], distance: cat[5], price_lak: parseFloat(cat[6]) || 0 } : null,
        participant: part ? {
          first_name: part[2],
          last_name: part[3],
          nickname: part[4],
          gender: part[5],
          phone: String(part[8] || ""),
          email: part[9],
          jersey_size: part[15]
        } : null,
        result: function() {
          if (!_resPublished(String(reg[2]))) return null;
          var rr = null;
          _rows(SN.RESULTS).rows.some(function(x) {
            if (String(x[1]) === String(reg[0])) {
              rr = x;
              return true;
            }
          });
          return rr ? { status: rr[9], elapsed_time: _timeTxt(rr[6]), category_rank: rr[8], overall_rank: rr[7] } : null;
        }(),
        last_payment: last ? {
          status: last[7],
          amount: last[3],
          method: last[4],
          date: last[5] ? new Date(last[5]).toISOString() : "",
          note: String(last[7]).toUpperCase() === "REJECTED" ? String(last[10] || "") : ""
        } : null
      };
    }
    function findRegistration(body) {
      var num = String(body.reg_number || "").trim().toUpperCase();
      var phone = String(body.phone || "");
      if (!num || _digits(phone).length < 7) throw new Error("ໃສ່ເລກລົງທະບຽນ ແລະ ເບີໂທ");
      var cache = CacheService.getScriptCache(), key = "evf_" + _digits(phone).slice(-8);
      var tries = parseInt(cache.get(key) || "0");
      if (tries >= 5) throw new Error("ລອງຫຼາຍເກີນໄປ — ລໍ 15 ນາທີ");
      var R = _rows(SN.REGISTRATIONS), reg = null;
      R.rows.some(function(r) {
        if (String(r[1]).toUpperCase() === num) {
          reg = r;
          return true;
        }
      });
      var ok = false;
      if (reg) _rows(SN.PARTICIPANTS).rows.some(function(p) {
        if (String(p[0]) === String(reg[3])) {
          ok = _samePhone(p[8], phone) || _samePhone(p[11], phone);
          return true;
        }
      });
      if (!ok) {
        cache.put(key, String(tries + 1), 900);
        throw new Error("ບໍ່ພົບ — ກວດເລກລົງທະບຽນ ແລະ ເບີໂທ");
      }
      return { qr_token: reg[15] };
    }
    function _saveSlip(dataUrl, name) {
      var m = String(dataUrl || "").match(/^data:(image\/(?:jpeg|jpg|png|webp|heic|heif)|application\/pdf);base64,([A-Za-z0-9+\/=]+)$/);
      if (!m) throw new Error("ໄຟລ໌ສະລິບຕ້ອງເປັນຮູບ (JPG/PNG) ຫຼື PDF");
      var bytes = Utilities.base64Decode(m[2]);
      if (bytes.length > 5 * 1024 * 1024) throw new Error("ໄຟລ໌ສະລິບໃຫຍ່ເກີນ 5MB");
      var it = DriveApp.getFoldersByName(SLIP_FOLDER);
      var folder = it.hasNext() ? it.next() : DriveApp.createFolder(SLIP_FOLDER);
      var ext = m[1] === "application/pdf" ? "pdf" : m[1].split("/")[1].replace("jpeg", "jpg");
      return folder.createFile(Utilities.newBlob(bytes, m[1], name + "." + ext)).getId();
    }
    function _addPayment(reg, pay, regRow, R) {
      var now = /* @__PURE__ */ new Date(), payId = _payId();
      var fileId = _saveSlip(pay.proof_image, String(reg[1]) + "-" + Utilities.formatDate(now, TZ, "yyyyMMdd-HHmm"));
      _ensureSheet(SN.PAYMENTS).appendRow([
        payId,
        reg[0],
        _txt(String(pay.payment_reference || "").slice(0, 60)),
        parseFloat(pay.amount) || 0,
        ["BANK_TRANSFER", "QR_PAYMENT", "CASH", "ONLINE", "OTHER"].indexOf(String(pay.payment_method)) > -1 ? pay.payment_method : "BANK_TRANSFER",
        now,
        fileId,
        "PENDING_VERIFICATION",
        "",
        "",
        String(pay.note || "").slice(0, 200),
        now
      ]);
      R.sheet.getRange(regRow, 11).setValue("PENDING_VERIFICATION");
      R.sheet.getRange(regRow, 19).setValue(now);
      return payId;
    }
    function _mailRegistrant(to, subject, lines) {
      if (_evtSB()) EVT_STORE_.flush();
      if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return;
      try {
        MailApp.sendEmail(to, subject, lines.join("\n"), { name: "Sevenday Bike" });
      } catch (e) {
        Logger.log("mail registrant: " + e.message);
      }
    }
    function _regLink(qr) {
      return SITE_URL + "events-registration.html?t=" + qr;
    }
    async function createRegistration(body) {
      var evId = String(body.event_id || "");
      var catId = String(body.category_id || "");
      var p = body.participant || {};
      if (!evId || !catId) throw new Error("event_id and category_id required");
      ["first_name", "last_name", "phone"].forEach(function(k) {
        if (!String(p[k] || "").trim()) throw new Error("ກະລຸນາໃສ່ " + k);
      });
      if (_digits(p.phone).length < 7) throw new Error("ເບີໂທບໍ່ຖືກຕ້ອງ");
      var lock = LockService2.getScriptLock();
      if (!lock.tryLock(2e4)) throw new Error("ລະບົບກຳລັງຫຍຸ້ງ — ລອງໃໝ່ອີກຄັ້ງ");
      try {
        var ev = null;
        _rows(SN.EVENTS).rows.some(function(e) {
          if (String(e[0]) === evId) {
            ev = e;
            return true;
          }
        });
        if (!ev) throw new Error("ບໍ່ພົບງານນີ້");
        var rs = _regState(ev);
        if (rs !== "OPEN") throw new Error(rs === "SOON" ? "ຍັງບໍ່ເປີດຮັບສະໝັກ" : "ປິດຮັບສະໝັກແລ້ວ");
        var C = _rows(SN.CATEGORIES), cat = null, catRow = 0;
        for (var j = 0; j < C.rows.length; j++) if (String(C.rows[j][0]) === catId && String(C.rows[j][1]) === evId) {
          cat = C.rows[j];
          catRow = j + 2;
          break;
        }
        if (!cat || String(cat[12] || "ACTIVE").toUpperCase() !== "ACTIVE") throw new Error("ລຸ້ນນີ້ບໍ່ເປີດຮັບ");
        var capacity = parseInt(cat[7]) || 0, regCount = parseInt(cat[8]) || 0;
        if (capacity > 0 && regCount >= capacity) throw new Error("ລຸ້ນ " + cat[3] + " ເຕັມແລ້ວ");
        var g = String(p.gender || "").toLowerCase(), rule = String(cat[11] || "ALL").toUpperCase();
        if (rule === "MALE" && g !== "male") throw new Error("ລຸ້ນນີ້ສຳລັບຜູ້ຊາຍເທົ່ານັ້ນ");
        if (rule === "FEMALE" && g !== "female") throw new Error("ລຸ້ນນີ້ສຳລັບຜູ້ຍິງເທົ່ານັ້ນ");
        if (p.date_of_birth && (cat[9] || cat[10])) {
          var ref = ev[6] ? new Date(ev[6]) : /* @__PURE__ */ new Date(), dob = new Date(p.date_of_birth);
          var age = ref.getFullYear() - dob.getFullYear() - (ref.getMonth() < dob.getMonth() || ref.getMonth() === dob.getMonth() && ref.getDate() < dob.getDate() ? 1 : 0);
          if (cat[9] && age < parseInt(cat[9])) throw new Error("ອາຍຸຕ່ຳສຸດຂອງລຸ້ນນີ້ " + cat[9] + " ປີ");
          if (cat[10] && age > parseInt(cat[10])) throw new Error("ອາຍຸສູງສຸດຂອງລຸ້ນນີ້ " + cat[10] + " ປີ");
        }
        var custId = body.token ? _readToken(body.token) : null;
        var email = String(p.email || "").toLowerCase().trim();
        if (!custId && SB_WEB_.on()) {
          custId = String((await SB_WEB_.rpc("web_customer_upsert", { p: {
            name: (String(p.first_name) + " " + String(p.last_name)).trim(),
            phone: String(p.phone == null ? "" : p.phone).trim(),
            email,
            match_email: true,
            prefix: "CU-EVT-"
          } })).customer_id);
        }
        if (!custId) {
          var posC = _posRows("Customers");
          posC.rows.some(function(c) {
            if (email && String(c[5]).toLowerCase().trim() === email || _samePhone(c[2], p.phone)) {
              custId = String(c[0]);
              return true;
            }
          });
          if (!custId) {
            custId = "CU-EVT-" + (/* @__PURE__ */ new Date()).getTime();
            posC.sheet.appendRow([custId, (String(p.first_name) + " " + String(p.last_name)).trim(), _txt(p.phone), 0, /* @__PURE__ */ new Date(), email, ""]);
          }
        }
        var P = _rows(SN.PARTICIPANTS), partId = null, partRow = 0, now = /* @__PURE__ */ new Date();
        var fn = String(p.first_name).trim(), ln = String(p.last_name).trim();
        for (var pi = 0; pi < P.rows.length; pi++) {
          var pr = P.rows[pi];
          if (String(pr[1]) === custId && String(pr[2]).trim().toLowerCase() === fn.toLowerCase() && String(pr[3]).trim().toLowerCase() === ln.toLowerCase()) {
            partId = String(pr[0]);
            partRow = pi + 2;
            break;
          }
        }
        var R = _rows(SN.REGISTRATIONS), dup = null, evCount = 0;
        R.rows.forEach(function(r) {
          if (String(r[2]) !== evId) return;
          evCount++;
          if (partId && String(r[3]) === partId && String(r[11]).toUpperCase() !== "CANCELLED") dup = r;
        });
        if (dup) throw new Error(fn + " " + ln + " ສະໝັກງານນີ້ແລ້ວ (" + dup[1] + ")");
        var fields = [
          [5, String(p.nickname || "").trim()],
          [6, g],
          [7, p.date_of_birth ? new Date(p.date_of_birth) : ""],
          [8, String(p.nationality || "").trim()],
          [9, _txt(p.phone)],
          [10, email],
          [11, String(p.emergency_name || "").trim()],
          [12, _txt(p.emergency_phone)],
          [13, String(p.bike_brand || "").trim()],
          [14, String(p.bike_model || "").trim()],
          [15, String(p.bike_wheel_size || "").trim()],
          [16, String(p.jersey_size || "").trim().toUpperCase()],
          [17, String(p.medical_note || "").trim().slice(0, 300)]
        ];
        if (partId) {
          fields.forEach(function(f) {
            if (f[1] !== "" && f[1] !== null) P.sheet.getRange(partRow, f[0]).setValue(f[1]);
          });
          P.sheet.getRange(partRow, 19).setValue(now);
        } else {
          partId = _partId();
          P.sheet.appendRow([partId, custId, fn, ln].concat(fields.map(function(f) {
            return f[1];
          }), [now, now]));
        }
        var seq = evCount + 1, regId = _regId(ev[1], seq), regNum = _regNumber(ev[1], seq), qr = _qrToken();
        var pn = _priceNow(cat, _earlyUsed(R.rows));
        var regular = pn.regular, discount = regular - pn.price, total = pn.price, free = total <= 0;
        var bib = free ? _nextBib(evId, catId) : "";
        R.sheet.appendRow([
          regId,
          regNum,
          evId,
          partId,
          catId,
          bib ? _bibCell(bib) : "",
          now,
          regular,
          discount,
          total,
          free ? "PAID" : "UNPAID",
          free ? "CONFIRMED" : "PENDING",
          "NOT_CHECKED_IN",
          "",
          "",
          qr,
          String(body.notes || "").slice(0, 300),
          now,
          now
        ]);
        var regRow = R.sheet.getLastRow();
        _ensureSheet(SN.CATEGORIES).getRange(catRow, 9).setValue(regCount + 1);
        var payStatus = free ? "PAID" : "UNPAID";
        if (!free && body.payment && body.payment.proof_image) {
          _addPayment([regId, regNum], body.payment, regRow, { sheet: R.sheet });
          payStatus = "PENDING_VERIFICATION";
        }
      } finally {
        lock.releaseLock();
      }
      _notify("ລົງທະບຽນໃໝ່ " + regNum, [
        "ງານ: " + ev[2],
        "ລຸ້ນ: " + cat[3],
        "ຜູ້ແຂ່ງ: " + fn + " " + ln + "  ໂທ: " + p.phone,
        "ເລກລົງທະບຽນ: " + regNum,
        "ຍອດ: ₭" + total.toLocaleString() + (discount > 0 ? " (Early Bird, ປົກກະຕິ ₭" + regular.toLocaleString() + ")" : ""),
        "ສະຖານະຊຳລະ: " + payStatus,
        "",
        "ກວດສະລິບ: " + SITE_URL + "admin-events-participants.html?event_id=" + evId
      ]);
      _mailRegistrant(email, "Sevenday — ໄດ້ຮັບການສະໝັກ " + ev[2], [
        "ສະບາຍດີ " + fn + ",",
        "",
        "ພວກເຮົາໄດ້ຮັບການສະໝັກ " + ev[2] + " (" + cat[3] + ") ແລ້ວ.",
        "ເລກລົງທະບຽນ: " + regNum,
        free ? "ສະຖານະ: ຢືນຢັນແລ້ວ · BIB " + bib : payStatus === "PENDING_VERIFICATION" ? "ສະຖານະ: ລໍກວດສະລິບ" : "ສະຖານະ: ລໍຊຳລະ ₭" + total.toLocaleString(),
        "",
        "ເບິ່ງສະຖານະ ແລະ QR Check-in:",
        _regLink(qr),
        "",
        "ເກັບລິ້ງນີ້ໄວ້ — ຢ່າແຊຣ໌ໃຫ້ຄົນອື່ນ.",
        "",
        "Sevenday Bike · 020 9884 4344"
      ]);
      return {
        registration_id: regId,
        reg_number: regNum,
        qr_token: qr,
        total,
        regular_price: regular,
        discount,
        early_bird: discount > 0,
        payment_status: payStatus,
        reg_status: free ? "CONFIRMED" : "PENDING",
        bib_number: bib,
        link: _regLink(qr)
      };
    }
    function submitPayment(body) {
      var qr = String(body.qr_token || "").trim();
      var admin = _isAdmin(body.token);
      if (!qr && !(admin && body.registration_id)) throw new Error("qr_token required");
      if (!body.proof_image) throw new Error("ກະລຸນາແນບສະລິບ");
      var lock = LockService2.getScriptLock();
      if (!lock.tryLock(2e4)) throw new Error("ລະບົບກຳລັງຫຍຸ້ງ — ລອງໃໝ່");
      try {
        var R = _rows(SN.REGISTRATIONS), found = null;
        for (var i = 0; i < R.rows.length; i++) {
          var r = R.rows[i];
          if (qr && String(r[15]) === qr || !qr && String(r[0]) === String(body.registration_id)) {
            found = { row: i + 2, data: r };
            break;
          }
        }
        if (!found) throw new Error("ບໍ່ພົບການລົງທະບຽນ");
        var d = found.data, ps = String(d[10]).toUpperCase();
        if (String(d[11]).toUpperCase() === "CANCELLED") throw new Error("ການລົງທະບຽນນີ້ຖືກຍົກເລີກແລ້ວ");
        if (ps === "PAID") throw new Error("ຊຳລະແລ້ວ — ບໍ່ຕ້ອງສົ່ງສະລິບອີກ");
        if (ps === "PENDING_VERIFICATION") throw new Error("ສົ່ງສະລິບແລ້ວ — ລໍທີມງານກວດ");
        var payId = _addPayment(d, body, found.row, R);
      } finally {
        lock.releaseLock();
      }
      _notify("ແຈ້ງຊຳລະ " + d[1], [
        "ເລກລົງທະບຽນ: " + d[1],
        "Payment: " + payId,
        "ຈຳນວນ: ₭" + (parseFloat(body.amount) || 0).toLocaleString(),
        "ລໍ Admin ກວດຢືນຢັນ"
      ]);
      return { payment_id: payId, status: "PENDING_VERIFICATION" };
    }
    function verifyPayment(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var payId = String(body.payment_id || "");
      var action = String(body.decision || "").toUpperCase();
      if (action !== "APPROVE" && action !== "REJECT") throw new Error("decision ຕ້ອງເປັນ APPROVE ຫຼື REJECT");
      if (!payId) throw new Error("payment_id required");
      var psh = _ensureSheet(SN.PAYMENTS);
      var pfound = _findRow(psh, 0, payId);
      if (!pfound) throw new Error("Payment not found: " + payId);
      var now = /* @__PURE__ */ new Date(), adminId = body.admin_id || "admin";
      var newStatus = action === "APPROVE" ? "PAID" : "REJECTED";
      psh.getRange(pfound.row, 8).setValue(newStatus);
      psh.getRange(pfound.row, 9).setValue(adminId);
      psh.getRange(pfound.row, 10).setValue(now);
      if (body.note) psh.getRange(pfound.row, 11).setValue(body.note);
      var regId = String(pfound.data[1]);
      var R = _rows(SN.REGISTRATIONS);
      for (var i = 0; i < R.rows.length; i++) {
        if (String(R.rows[i][0]) === regId) {
          var rsh = _ensureSheet(SN.REGISTRATIONS), rrow = i + 2;
          if (action === "APPROVE") {
            rsh.getRange(rrow, 11).setValue("PAID");
            rsh.getRange(rrow, 12).setValue("CONFIRMED");
            if (!R.rows[i][5]) {
              var bib = _nextBib(String(R.rows[i][2]), String(R.rows[i][4]));
              rsh.getRange(rrow, 6).setValue(_bibCell(bib));
            }
          } else {
            rsh.getRange(rrow, 11).setValue("REJECTED");
          }
          try {
            var reg2 = rsh.getRange(rrow, 1, 1, 19).getValues()[0], who = null;
            _rows(SN.PARTICIPANTS).rows.some(function(pp) {
              if (String(pp[0]) === String(reg2[3])) {
                who = pp;
                return true;
              }
            });
            if (who) _mailRegistrant(
              String(who[9]),
              action === "APPROVE" ? "Sevenday — ຢືນຢັນການສະໝັກ " + reg2[1] : "Sevenday — ສະລິບບໍ່ຜ່ານ " + reg2[1],
              action === "APPROVE" ? ["ສະບາຍດີ " + who[2] + ",", "", "ການຊຳລະຜ່ານແລ້ວ. ເລກ BIB ຂອງທ່ານ: " + reg2[5], "", "QR ສຳລັບ Check-in:", _regLink(reg2[15])] : ["ສະບາຍດີ " + who[2] + ",", "", "ສະລິບຂອງທ່ານກວດບໍ່ຜ່ານ: " + (body.note || "-"), "ກະລຸນາສົ່ງສະລິບໃໝ່:", _regLink(reg2[15])]
            );
          } catch (mailErr) {
            Logger.log(mailErr.message);
          }
          rsh.getRange(rrow, 19).setValue(now);
          break;
        }
      }
      _audit("VERIFY_PAYMENT", body, "", "OK", { payment_id: payId, status: newStatus, action });
      return { ok: true, payment_id: payId, status: newStatus, action };
    }
    function _bibNum(v) {
      var m = String(v == null ? "" : v).match(/\d+/);
      return m ? parseInt(m[0], 10) : 0;
    }
    function _bibTxt(n) {
      n = parseInt(n, 10) || 0;
      return n < 10 ? "0" + n : String(n);
    }
    function _bibCell(n) {
      return "'" + _bibTxt(n);
    }
    function _nextBib(eventId, catId) {
      var R = _rows(SN.REGISTRATIONS), used = {};
      R.rows.forEach(function(r) {
        if (String(r[2]) === String(eventId) && String(r[4]) === String(catId) && _bibNum(r[5]) && String(r[11]).toUpperCase() !== "CANCELLED") used[_bibNum(r[5])] = true;
      });
      for (var n = 1; n <= 9999; n++) {
        if (!used[n]) return _bibTxt(n);
      }
      return _bibTxt(9999);
    }
    function renumberBibs(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      if (!evId) throw new Error("event_id required");
      var lock = LockService2.getScriptLock();
      if (!lock.tryLock(2e4)) throw new Error("ລະບົບກຳລັງຫຍຸ້ງ — ລອງໃໝ່");
      try {
        var R = _rows(SN.REGISTRATIONS), byCat = {}, changed = 0, map = {};
        R.rows.forEach(function(r, i) {
          if (String(r[2]) !== evId || !_bibNum(r[5]) || String(r[11]).toUpperCase() === "CANCELLED") return;
          (byCat[String(r[4])] = byCat[String(r[4])] || []).push({ i, n: _bibNum(r[5]), t: new Date(r[6]).getTime() || 0, id: String(r[0]) });
        });
        var rsh = _ensureSheet(SN.REGISTRATIONS);
        Object.keys(byCat).forEach(function(c) {
          byCat[c].sort(function(a, b) {
            return a.n - b.n || a.t - b.t;
          }).forEach(function(x, k) {
            var want = _bibTxt(k + 1);
            if (String(R.rows[x.i][5]) !== want) {
              rsh.getRange(x.i + 2, 6).setValue("'" + want);
              changed++;
            }
            map[x.id] = want;
          });
        });
        var rs = _ensureSheet(SN.RESULTS);
        if (rs.getLastRow() > 1) {
          var v = rs.getRange(2, 1, rs.getLastRow() - 1, 4).getValues();
          v.forEach(function(r, i) {
            if (map[String(r[1])] && String(r[3]) !== map[String(r[1])]) rs.getRange(i + 2, 4).setValue("'" + map[String(r[1])]);
          });
        }
        _audit("RENUMBER_BIB", body, "", "OK", { event_id: evId, changed });
        return { ok: true, changed, categories: Object.keys(byCat).length };
      } finally {
        lock.releaseLock();
      }
    }
    function assignBib(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var regId = String(body.registration_id || "");
      var bib = parseInt(body.bib_number);
      if (!regId || !bib) throw new Error("registration_id and bib_number required");
      var R = _rows(SN.REGISTRATIONS), found = null;
      for (var i = 0; i < R.rows.length; i++) if (String(R.rows[i][0]) === regId) {
        found = { row: i + 2, data: R.rows[i] };
        break;
      }
      if (!found) throw new Error("Registration not found");
      var evId = String(found.data[2]), catId = String(found.data[4]);
      for (var j = 0; j < R.rows.length; j++) {
        if (String(R.rows[j][2]) === evId && String(R.rows[j][4]) === catId && _bibNum(R.rows[j][5]) === bib && String(R.rows[j][0]) !== regId && String(R.rows[j][11]).toUpperCase() !== "CANCELLED") throw new Error("BIB " + _bibTxt(bib) + " ຖືກໃຊ້ແລ້ວໃນລຸ້ນນີ້");
      }
      var rsh = _ensureSheet(SN.REGISTRATIONS);
      rsh.getRange(found.row, 6).setValue(_bibCell(bib));
      rsh.getRange(found.row, 19).setValue(/* @__PURE__ */ new Date());
      _audit("ASSIGN_BIB", { admin_id: body.admin_id, event_id: evId }, regId, "OK", { bib });
      return { ok: true, registration_id: regId, bib_number: _bibTxt(bib) };
    }
    function _audit(action, body, regId, result, detail) {
      try {
        var sh = _ensureSheet(SN.AUDIT);
        sh.appendRow([
          "LOG-" + _uuid8(),
          /* @__PURE__ */ new Date(),
          action,
          String(body.admin_id || "admin").slice(0, 60),
          String(body.event_id || ""),
          String(regId || ""),
          String(result || ""),
          detail ? JSON.stringify(detail).slice(0, 500) : ""
        ]);
      } catch (e) {
        Logger.log("audit failed: " + e.message);
      }
    }
    function _partOf(partId) {
      var P = _rows(SN.PARTICIPANTS);
      for (var j = 0; j < P.rows.length; j++) if (String(P.rows[j][0]) === String(partId)) {
        var p = P.rows[j];
        return { first_name: p[2], last_name: p[3], nickname: p[4], gender: p[5], jersey_size: p[15] };
      }
      return null;
    }
    function _catName(catId) {
      var C = _rows(SN.CATEGORIES);
      for (var m = 0; m < C.rows.length; m++) if (String(C.rows[m][0]) === String(catId)) return { category_name: C.rows[m][3], distance: C.rows[m][5] };
      return { category_name: "", distance: "" };
    }
    function _ciPayload(d, extra) {
      var c = _catName(d[4]);
      var out = {
        registration_id: d[0],
        reg_number: d[1],
        event_id: d[2],
        bib_number: d[5],
        category_id: d[4],
        category_name: c.category_name,
        distance: c.distance,
        payment_status: d[10],
        reg_status: d[11],
        participant: _partOf(d[3])
      };
      for (var k in extra) out[k] = extra[k];
      return out;
    }
    function checkIn(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var regId = String(body.registration_id || "");
      var qr = String(body.qr_token || "").trim();
      var bibNo = String(body.bib_number || "").trim();
      var evId = String(body.event_id || "");
      if (!evId) throw new Error("event_id required");
      if (!regId && !qr && !bibNo) throw new Error("ຕ້ອງໃສ່ registration_id, qr_token ຫຼື bib_number");
      var lock = LockService2.getScriptLock();
      if (!lock.tryLock(1e4)) throw new Error("ລະບົບກຳລັງຫຍຸ້ງ — ລອງໃໝ່");
      try {
        var R = _rows(SN.REGISTRATIONS), found = null, bibHits = [], catSel = String(body.category_id || "");
        for (var i = 0; i < R.rows.length; i++) {
          var r = R.rows[i];
          if (regId && String(r[0]) === regId || qr && String(r[15]) === qr) {
            found = { row: i + 2, data: r };
            break;
          }
          if (!regId && !qr && bibNo && String(r[2]) === evId && _bibNum(r[5]) === _bibNum(bibNo) && String(r[11]).toUpperCase() !== "CANCELLED" && (!catSel || String(r[4]) === catSel)) bibHits.push({ row: i + 2, data: r });
        }
        if (!found && bibHits.length === 1) found = bibHits[0];
        if (!found && bibHits.length > 1) {
          var cm = {};
          _rows(SN.CATEGORIES).rows.forEach(function(c) {
            cm[String(c[0])] = c[3];
          });
          var pm = {};
          _rows(SN.PARTICIPANTS).rows.forEach(function(p) {
            pm[String(p[0])] = p;
          });
          return { status: "MULTI", bib_number: _bibTxt(_bibNum(bibNo)), matches: bibHits.map(function(h) {
            var p = pm[String(h.data[3])] || [];
            return { registration_id: h.data[0], category_id: h.data[4], category_name: cm[String(h.data[4])] || "", first_name: p[2] || "", last_name: p[3] || "" };
          }) };
        }
        var key = { qr: qr ? qr.slice(0, 6) + "…" : "", bib: bibNo, reg: regId };
        if (!found) {
          _audit("CHECKIN", body, regId, "NOT_FOUND", key);
          return { status: "NOT_FOUND" };
        }
        var d = found.data;
        if (String(d[2]) !== evId) {
          _audit("CHECKIN", body, d[0], "WRONG_EVENT", key);
          return { status: "WRONG_EVENT", registration_id: d[0] };
        }
        if (String(d[11]).toUpperCase() === "CANCELLED") {
          _audit("CHECKIN", body, d[0], "CANCELLED", key);
          return _ciPayload(d, { status: "CANCELLED" });
        }
        if (String(d[10]).toUpperCase() !== "PAID") {
          _audit("CHECKIN", body, d[0], "UNPAID", key);
          return _ciPayload(d, { status: "UNPAID" });
        }
        if (String(d[12]).toUpperCase() === "CHECKED_IN") {
          _audit("CHECKIN", body, d[0], "ALREADY", key);
          return _ciPayload(d, {
            status: "ALREADY",
            checkin_time: d[13] ? new Date(d[13]).toISOString() : "",
            checked_by: d[14]
          });
        }
        var now = /* @__PURE__ */ new Date(), adminId = String(body.admin_id || "admin").slice(0, 60);
        var rsh = R.sheet;
        rsh.getRange(found.row, 13, 1, 3).setValues([["CHECKED_IN", now, adminId]]);
        rsh.getRange(found.row, 19).setValue(now);
        _audit("CHECKIN", body, d[0], "OK", key);
        return _ciPayload(d, { status: "OK", checkin_time: now.toISOString(), checked_by: adminId });
      } finally {
        lock.releaseLock();
      }
    }
    function undoCheckIn(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var regId = String(body.registration_id || "");
      var reason = String(body.reason || "").trim();
      if (!regId) throw new Error("registration_id required");
      if (!reason) throw new Error("ຕ້ອງໃສ່ເຫດຜົນ");
      var R = _rows(SN.REGISTRATIONS), found = null;
      for (var i = 0; i < R.rows.length; i++) if (String(R.rows[i][0]) === regId) {
        found = { row: i + 2, data: R.rows[i] };
        break;
      }
      if (!found) throw new Error("Registration not found");
      if (String(found.data[12]).toUpperCase() !== "CHECKED_IN") throw new Error("ຍັງບໍ່ໄດ້ check-in");
      R.sheet.getRange(found.row, 13, 1, 3).setValues([["NOT_CHECKED_IN", "", ""]]);
      R.sheet.getRange(found.row, 19).setValue(/* @__PURE__ */ new Date());
      body.event_id = String(found.data[2]);
      _audit("UNDO_CHECKIN", body, regId, "OK", {
        reason: reason.slice(0, 200),
        prev_time: found.data[13] ? new Date(found.data[13]).toISOString() : "",
        prev_by: found.data[14]
      });
      return { ok: true, registration_id: regId, checkin_status: "NOT_CHECKED_IN" };
    }
    function uploadCover(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var m = String(body.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/);
      if (!m) throw new Error("ຕ້ອງເປັນຮູບ JPG / PNG");
      var bytes = Utilities.base64Decode(m[2]);
      if (bytes.length > 5 * 1024 * 1024) throw new Error("ຮູບໃຫຍ່ເກີນ 5MB");
      var it = DriveApp.getFoldersByName("Sevenday Web Images");
      var folder = it.hasNext() ? it.next() : DriveApp.createFolder("Sevenday Web Images");
      var kind = /^(logo|slide)$/.test(String(body.kind)) ? body.kind : "event-cover-" + (body.event_id || "new");
      var ext = m[1] === "image/png" ? ".png" : m[1] === "image/webp" ? ".webp" : ".jpg";
      var f = folder.createFile(Utilities.newBlob(bytes, m[1], kind + "-" + Date.now() + ext));
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      _audit("UPLOAD_COVER", body, "", "OK", { file: f.getId() });
      return { url: f.getUrl() };
    }
    function deleteEvent(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      var n = _rows(SN.REGISTRATIONS).rows.filter(function(r) {
        return String(r[2]) === evId;
      }).length;
      if (n) throw new Error("ມີຄົນສະໝັກແລ້ວ " + n + " ຄົນ — ລຶບບໍ່ໄດ້. ໃຫ້ປ່ຽນສະຖານະເປັນ Cancelled ແທນ");
      var C = _rows(SN.CATEGORIES);
      for (var i = C.rows.length - 1; i >= 0; i--) if (String(C.rows[i][1]) === evId) C.sheet.deleteRow(i + 2);
      var sh = _ensureSheet(SN.EVENTS), f = _findRow(sh, 0, evId);
      if (!f) throw new Error("ບໍ່ພົບງານ");
      sh.deleteRow(f.row);
      _audit("DELETE_EVENT", body, "", "OK", { event_name: f.data[2], event_code: f.data[1] });
      return { ok: true };
    }
    function deleteCategory(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var catId = String(body.category_id || "");
      var n = _rows(SN.REGISTRATIONS).rows.filter(function(r) {
        return String(r[4]) === catId;
      }).length;
      if (n) throw new Error("ມີຄົນສະໝັກລຸ້ນນີ້ແລ້ວ " + n + " ຄົນ — ລຶບບໍ່ໄດ້. ໃຫ້ປ່ຽນສະຖານະເປັນ CLOSED ແທນ");
      var sh = _ensureSheet(SN.CATEGORIES), f = _findRow(sh, 0, catId);
      if (!f) throw new Error("ບໍ່ພົບລຸ້ນ");
      sh.deleteRow(f.row);
      body.event_id = String(f.data[1]);
      _audit("DELETE_CATEGORY", body, "", "OK", { category_name: f.data[3] });
      return { ok: true };
    }
    function updateParticipant(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var regId = String(body.registration_id || "");
      var f = body.fields || {};
      if (!regId) throw new Error("registration_id required");
      var R = _rows(SN.REGISTRATIONS), reg = null, regRow = 0;
      for (var i = 0; i < R.rows.length; i++) if (String(R.rows[i][0]) === regId) {
        reg = R.rows[i];
        regRow = i + 2;
        break;
      }
      if (!reg) throw new Error("Registration not found");
      var COLS = {
        first_name: 3,
        last_name: 4,
        nickname: 5,
        gender: 6,
        date_of_birth: 7,
        nationality: 8,
        phone: 9,
        email: 10,
        emergency_name: 11,
        emergency_phone: 12,
        bike_brand: 13,
        bike_model: 14,
        bike_wheel_size: 15,
        jersey_size: 16,
        medical_note: 17
      };
      var psh = _ensureSheet(SN.PARTICIPANTS), pf = _findRow(psh, 0, reg[3]);
      if (!pf) throw new Error("Participant not found");
      var changes = {}, now = /* @__PURE__ */ new Date();
      Object.keys(f).forEach(function(k) {
        if (!COLS[k]) return;
        var v = String(f[k] == null ? "" : f[k]).trim().slice(0, 200);
        if (k === "date_of_birth" && v) v = new Date(v);
        var old = pf.data[COLS[k] - 1];
        var oldS = old instanceof Date ? old.toISOString().slice(0, 10) : String(old);
        var newS = v instanceof Date ? v.toISOString().slice(0, 10) : v;
        if (oldS === newS) return;
        psh.getRange(pf.row, COLS[k]).setValue(v);
        changes[k] = { from: oldS, to: newS };
      });
      if (body.notes !== void 0 && String(body.notes) !== String(reg[16])) {
        R.sheet.getRange(regRow, 17).setValue(String(body.notes).slice(0, 500));
        changes.notes = { from: String(reg[16]), to: String(body.notes) };
      }
      if (!Object.keys(changes).length) return { ok: true, changed: 0 };
      psh.getRange(pf.row, 19).setValue(now);
      R.sheet.getRange(regRow, 19).setValue(now);
      body.event_id = String(reg[2]);
      _audit("UPDATE_PARTICIPANT", body, regId, "OK", changes);
      return { ok: true, changed: Object.keys(changes).length };
    }
    function logExport(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      _audit("EXPORT", body, "", "OK", { format: String(body.format || ""), rows: parseInt(body.rows) || 0, filter: body.filter || null });
      return { ok: true };
    }
    function getParticipants(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      var catId = String(body.category_id || "");
      var payStatus = String(body.payment_status || "").toUpperCase();
      var ciStatus = String(body.checkin_status || "").toUpperCase();
      var regStatus = String(body.reg_status || "").toUpperCase();
      var search = String(body.search || "").toLowerCase();
      if (!evId) throw new Error("event_id required");
      var R = _rows(SN.REGISTRATIONS);
      var P = _rows(SN.PARTICIPANTS);
      var C = _rows(SN.CATEGORIES);
      var partMap = {}, catMap = {};
      P.rows.forEach(function(r) {
        if (r[0]) partMap[String(r[0])] = r;
      });
      C.rows.forEach(function(r) {
        if (r[0]) catMap[String(r[0])] = r;
      });
      var page = Math.max(1, parseInt(body.page || 1));
      var limit = Math.min(body.export ? 5e3 : 200, parseInt(body.limit || 50));
      var payMap = {};
      if (body.full) {
        _rows(SN.PAYMENTS).rows.forEach(function(p) {
          if (!p[0]) return;
          var k = String(p[1]), prev = payMap[k];
          if (!prev || new Date(p[11]) >= new Date(prev[11])) payMap[k] = p;
        });
      }
      var list = R.rows.filter(function(r) {
        if (!r[0] || String(r[2]) !== evId) return false;
        if (catId && String(r[4]) !== catId) return false;
        if (payStatus && String(r[10]).toUpperCase() !== payStatus) return false;
        if (ciStatus && String(r[12]).toUpperCase() !== ciStatus) return false;
        if (regStatus && String(r[11]).toUpperCase() !== regStatus) return false;
        if (search) {
          var part = partMap[String(r[3])];
          if (!part) return false;
          var fullName = (String(part[2]) + " " + String(part[3])).toLowerCase();
          if (fullName.indexOf(search) < 0 && String(r[5]).indexOf(search) < 0 && String(r[1]).toLowerCase().indexOf(search) < 0) return false;
        }
        return true;
      }).map(function(r) {
        var part = partMap[String(r[3])] || [];
        var cat = catMap[String(r[4])] || [];
        var o = {
          registration_id: r[0],
          reg_number: r[1],
          bib_number: r[5],
          reg_date: r[6] ? new Date(r[6]).toISOString() : "",
          total: r[9],
          payment_status: r[10],
          reg_status: r[11],
          checkin_status: r[12],
          checkin_time: r[13] ? new Date(r[13]).toISOString() : "",
          first_name: part[2] || "",
          last_name: part[3] || "",
          nickname: part[4] || "",
          gender: part[5] || "",
          phone: part[8] || "",
          email: part[9] || "",
          jersey_size: part[15] || "",
          bike_brand: part[12] || "",
          bike_model: part[13] || "",
          category_name: cat[3] || "",
          category_code: cat[2] || "",
          distance: cat[5] || "",
          category_id: r[4]
        };
        if (body.full) {
          var pay = payMap[String(r[0])] || [];
          o.participant_id = r[3];
          o.date_of_birth = part[6] ? new Date(part[6]).toISOString().slice(0, 10) : "";
          o.nationality = part[7] || "";
          o.emergency_name = part[10] || "";
          o.emergency_phone = part[11] || "";
          o.bike_wheel_size = part[14] || "";
          o.medical_note = part[16] || "";
          o.subtotal = r[7];
          o.discount = r[8];
          o.notes = r[16] || "";
          o.checked_by = r[14] || "";
          o.payment = pay[0] ? {
            payment_id: pay[0],
            reference: pay[2],
            amount: pay[3],
            method: pay[4],
            date: pay[5] ? new Date(pay[5]).toISOString() : "",
            proof_image_id: pay[6],
            status: pay[7],
            verified_by: pay[8],
            verified_at: pay[9] ? new Date(pay[9]).toISOString() : "",
            note: pay[10]
          } : null;
        }
        return o;
      });
      list.sort(function(a, b) {
        var ab = parseInt(a.bib_number) || 1e9, bb = parseInt(b.bib_number) || 1e9;
        return ab - bb || String(a.reg_number).localeCompare(String(b.reg_number));
      });
      var total = list.length;
      var offset = (page - 1) * limit;
      return { participants: list.slice(offset, offset + limit), total, page, limit, pages: Math.ceil(total / limit) };
    }
    function getEventStats(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      if (!evId) throw new Error("event_id required");
      var R = _rows(SN.REGISTRATIONS);
      var C = _rows(SN.CATEGORIES);
      var stats = { registered: 0, paid: 0, pending: 0, cancelled: 0, checked_in: 0, revenue_lak: 0 };
      R.rows.forEach(function(r) {
        if (String(r[2]) !== evId || !r[0]) return;
        stats.registered++;
        var ps = String(r[10]).toUpperCase(), rs = String(r[11]).toUpperCase(), cs = String(r[12]).toUpperCase();
        if (ps === "PAID") stats.paid++;
        if (ps === "PENDING_VERIFICATION" || rs === "PENDING") stats.pending++;
        if (rs === "CANCELLED") stats.cancelled++;
        if (cs === "CHECKED_IN") stats.checked_in++;
        if (ps === "PAID") stats.revenue_lak += parseFloat(r[9]) || 0;
      });
      var capacity = 0;
      C.rows.forEach(function(r) {
        if (String(r[1]) === evId) capacity += parseInt(r[7]) || 0;
      });
      stats.capacity = capacity;
      stats.remaining = Math.max(0, capacity - stats.registered);
      var regIds = {};
      R.rows.forEach(function(r) {
        if (String(r[2]) === evId) regIds[String(r[0])] = 1;
      });
      stats.finished = _rows(SN.RESULTS).rows.filter(function(r) {
        return regIds[String(r[1])] && String(r[9]) === "FINISHED";
      }).length;
      stats.results_published = _resPublished(evId);
      return stats;
    }
    function adminSummary(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var by = {};
      _rows(SN.REGISTRATIONS).rows.forEach(function(r) {
        if (!r[0]) return;
        var k = String(r[2]), o = by[k] || (by[k] = { registered: 0, paid: 0, unpaid: 0, slips: 0, checked_in: 0, revenue_lak: 0 });
        var ps = String(r[10]).toUpperCase(), rs = String(r[11]).toUpperCase();
        if (rs === "CANCELLED") return;
        o.registered++;
        if (ps === "PAID") {
          o.paid++;
          o.revenue_lak += parseFloat(r[9]) || 0;
        } else if (ps === "PENDING_VERIFICATION") o.slips++;
        else o.unpaid++;
        if (String(r[12]).toUpperCase() === "CHECKED_IN") o.checked_in++;
      });
      var cap = {};
      _rows(SN.CATEGORIES).rows.forEach(function(r) {
        if (r[0]) {
          var k = String(r[1]);
          cap[k] = cap[k] === null ? null : parseInt(r[7]) ? (cap[k] || 0) + parseInt(r[7]) : null;
        }
      });
      var events = _rows(SN.EVENTS).rows.filter(function(r) {
        return r[0];
      }).map(function(r) {
        var o = _evPublic(r), s = by[String(r[0])] || { registered: 0, paid: 0, unpaid: 0, slips: 0, checked_in: 0, revenue_lak: 0 };
        Object.keys(s).forEach(function(k) {
          o[k] = s[k];
        });
        o.capacity = cap[String(r[0])] === void 0 ? 0 : cap[String(r[0])];
        o.results_published = _resPublished(String(r[0]));
        return o;
      });
      events.sort(function(a, b) {
        return String(b.event_date).localeCompare(String(a.event_date));
      });
      return { events, slips_total: events.reduce(function(n, e) {
        return n + e.slips;
      }, 0) };
    }
    function cancelRegistration(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var regId = String(body.registration_id || "");
      if (!regId) throw new Error("registration_id required");
      var R = _rows(SN.REGISTRATIONS), found = null;
      for (var i = 0; i < R.rows.length; i++) if (String(R.rows[i][0]) === regId) {
        found = { row: i + 2, data: R.rows[i] };
        break;
      }
      if (!found) throw new Error("Registration not found");
      var rsh = _ensureSheet(SN.REGISTRATIONS), now = /* @__PURE__ */ new Date();
      rsh.getRange(found.row, 12).setValue("CANCELLED");
      rsh.getRange(found.row, 11).setValue("REFUNDED");
      body.event_id = String(found.data[2]);
      _audit("CANCEL_REGISTRATION", body, regId, "OK", null);
      rsh.getRange(found.row, 19).setValue(now);
      var catId = String(found.data[4]);
      var csh = _ensureSheet(SN.CATEGORIES), cfound = _findRow(csh, 0, catId);
      if (cfound) {
        var cur = parseInt(cfound.data[8]) || 0;
        csh.getRange(cfound.row, 9).setValue(Math.max(0, cur - 1));
      }
      return { ok: true, registration_id: regId, status: "CANCELLED" };
    }
    function getMyEvents(body) {
      var custId = _readToken(body.token);
      if (!custId) throw new Error("SESSION_EXPIRED");
      var P = _rows(SN.PARTICIPANTS);
      var partIds = [];
      P.rows.forEach(function(r) {
        if (String(r[1]) === custId) partIds.push(String(r[0]));
      });
      if (!partIds.length) return { registrations: [] };
      var R = _rows(SN.REGISTRATIONS);
      var E = _rows(SN.EVENTS);
      var C = _rows(SN.CATEGORIES);
      var evMap = {}, catMap = {};
      E.rows.forEach(function(r) {
        if (r[0]) evMap[String(r[0])] = r;
      });
      C.rows.forEach(function(r) {
        if (r[0]) catMap[String(r[0])] = r;
      });
      var partName = {};
      P.rows.forEach(function(r) {
        if (String(r[1]) === custId) partName[String(r[0])] = (String(r[2]) + " " + String(r[3])).trim();
      });
      var list = R.rows.filter(function(r) {
        return r[0] && partIds.indexOf(String(r[3])) > -1;
      }).map(function(r) {
        var ev = evMap[String(r[2])] || [];
        var cat = catMap[String(r[4])] || [];
        return {
          participant_name: partName[String(r[3])] || "",
          registration_id: r[0],
          reg_number: r[1],
          bib_number: r[5],
          total: r[9],
          payment_status: r[10],
          reg_status: r[11],
          checkin_status: r[12],
          qr_token: r[15],
          event_name: ev[2] || "",
          event_date: _ymd(ev[6]),
          location: ev[9] || "",
          event_code: ev[1] || "",
          category_name: cat[3] || "",
          distance: cat[5] || ""
        };
      });
      list.sort(function(a, b) {
        return new Date(b.event_date || 0) - new Date(a.event_date || 0);
      });
      return { registrations: list };
    }
    var RES_STATUS = ["FINISHED", "DNF", "DNS", "DSQ"];
    function _props() {
      return PropertiesService.getScriptProperties();
    }
    function _resPublished(evId) {
      return _props().getProperty("RESULTS_PUB_" + evId) === "1";
    }
    function _secs(v, clock) {
      if (v instanceof Date) return v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds();
      var t = String(v || "").trim().replace(/\./g, ":");
      if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(t)) return null;
      var p = t.split(":").map(Number);
      if (p.slice(1).some(function(x) {
        return x > 59;
      })) return null;
      if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
      return clock ? p[0] * 3600 + p[1] * 60 : p[0] * 60 + p[1];
    }
    function _hms(sec) {
      if (sec === null || sec === void 0 || sec === "") return "";
      var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
      return h + ":" + (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
    }
    function _timeTxt(v) {
      return v instanceof Date ? _hms(_secs(v)) : String(v || "");
    }
    function _rankEvent(data, evId) {
      var fin = data.filter(function(r) {
        return r[0] && String(r[9]) === "FINISHED" && _resEv[String(r[1])] === evId && _secs(r[6]) !== null;
      });
      function rank(list, col) {
        list.sort(function(x, y) {
          return _secs(x[6]) - _secs(y[6]);
        });
        list.forEach(function(r, i) {
          r[col] = i > 0 && _secs(list[i - 1][6]) === _secs(r[6]) ? list[i - 1][col] : i + 1;
        });
      }
      rank(fin.slice(), 7);
      var byCat = {};
      fin.forEach(function(r) {
        (byCat[r[2]] = byCat[r[2]] || []).push(r);
      });
      Object.keys(byCat).forEach(function(k) {
        rank(byCat[k], 8);
      });
      data.forEach(function(r) {
        if (r[0] && _resEv[String(r[1])] === evId && String(r[9]) !== "FINISHED") {
          r[7] = "";
          r[8] = "";
        }
      });
    }
    var _resEv = {};
    function _writeResults(sh, data) {
      var last = sh.getLastRow();
      if (last > data.length + 1) sh.getRange(data.length + 2, 1, last - data.length - 1, 12).setValues(
        Array.apply(null, Array(last - data.length - 1)).map(function() {
          return ["", "", "", "", "", "", "", "", "", "", "", ""];
        })
      );
      if (!data.length) return;
      sh.getRange(2, 1, data.length, 12).setValues(data.map(function(r) {
        var o = r.slice(0, 12);
        while (o.length < 12) o.push("");
        [4, 5, 6].forEach(function(c) {
          o[c] = o[c] === "" || o[c] === null ? "" : "'" + _timeTxt(o[c]);
        });
        return o;
      }));
    }
    function saveResults(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      var entries = body.entries || [];
      if (!evId) throw new Error("event_id required");
      var lock = LockService2.getScriptLock();
      if (!lock.tryLock(2e4)) throw new Error("ລະບົບກຳລັງຫຍຸ້ງ — ລອງໃໝ່");
      var saved = 0, errors = [], warnings = [];
      try {
        var starts = body.starts || {};
        Object.keys(starts).forEach(function(cid) {
          var v = String(starts[cid] || "").trim();
          if (!v) _props().deleteProperty("RES_START_" + cid);
          else if (_secs(v, true) === null) errors.push({ ref: "start", error: "ເວລາປ່ອຍຕົວບໍ່ຖືກ: " + v });
          else _props().setProperty("RES_START_" + cid, _hms(_secs(v, true)));
        });
        var R = _rows(SN.REGISTRATIONS), byBib = {}, byId = {};
        R.rows.forEach(function(r) {
          _resEv[String(r[0])] = String(r[2]);
          if (String(r[2]) !== evId) return;
          byId[String(r[0])] = r;
          if (_bibNum(r[5]) && String(r[11]).toUpperCase() !== "CANCELLED") (byBib[_bibNum(r[5])] = byBib[_bibNum(r[5])] || []).push(r);
        });
        var sh = _ensureSheet(SN.RESULTS), all = sh.getDataRange().getValues().slice(1).filter(function(r) {
          return r[0];
        });
        var rowOf = {};
        all.forEach(function(r, i) {
          rowOf[String(r[1])] = i;
        });
        var now = /* @__PURE__ */ new Date();
        entries.slice(0, 1e3).forEach(function(e, idx) {
          var ref = e.bib_number !== void 0 && e.bib_number !== "" ? "BIB " + e.bib_number : String(e.registration_id || "#" + (idx + 1));
          var reg = null;
          if (e.registration_id) reg = byId[String(e.registration_id)];
          else {
            var hits = (byBib[_bibNum(e.bib_number)] || []).filter(function(r) {
              return !e.category_id || String(r[4]) === String(e.category_id);
            });
            if (hits.length > 1) return errors.push({ ref, error: "BIB ນີ້ມີຫຼາຍລຸ້ນ — ເລືອກລຸ້ນກ່ອນບັນທຶກ" });
            reg = hits[0];
          }
          if (!reg) return errors.push({ ref, error: e.category_id ? "ບໍ່ພົບ BIB ນີ້ໃນລຸ້ນທີ່ເລືອກ" : "ບໍ່ພົບ BIB ນີ້ໃນງານ" });
          if (String(reg[11]).toUpperCase() === "CANCELLED") return errors.push({ ref, error: "ການລົງທະບຽນຖືກຍົກເລີກ" });
          if (String(reg[10]).toUpperCase() !== "PAID") return errors.push({ ref, error: "ຍັງບໍ່ໄດ້ຊຳລະ" });
          var st = String(e.status || "FINISHED").toUpperCase();
          if (RES_STATUS.indexOf(st) < 0) return errors.push({ ref, error: "ສະຖານະບໍ່ຖືກ" });
          var catId = String(reg[4]), start = "", finish = "", elapsed = "";
          if (st === "FINISHED") {
            if (e.elapsed_time) {
              var es = _secs(e.elapsed_time, false);
              if (es === null || es <= 0) return errors.push({ ref, error: "ເວລາບໍ່ຖືກ: " + e.elapsed_time });
              elapsed = _hms(es);
            } else {
              var fs = _secs(e.finish_time, true);
              if (fs === null) return errors.push({ ref, error: "ເວລາເຂົ້າເສັ້ນບໍ່ຖືກ: " + (e.finish_time || "-") });
              var gun = _props().getProperty("RES_START_" + catId);
              if (!gun) return errors.push({ ref, error: "ຍັງບໍ່ໄດ້ຕັ້ງເວລາປ່ອຍຕົວຂອງລຸ້ນນີ້" });
              var d = fs - _secs(gun, true);
              if (d <= 0) d += 86400;
              start = gun;
              finish = _hms(fs);
              elapsed = _hms(d);
            }
            if (String(reg[12]).toUpperCase() !== "CHECKED_IN") warnings.push({ ref, warning: "ຍັງບໍ່ໄດ້ Check-in" });
          }
          var i = rowOf[String(reg[0])];
          var row = [
            i === void 0 ? _resultId() : all[i][0],
            reg[0],
            catId,
            _bibNum(reg[5]) ? _bibCell(_bibNum(reg[5])) : "",
            start,
            finish,
            elapsed,
            "",
            "",
            st,
            i === void 0 ? now : all[i][10],
            now
          ];
          if (i === void 0) {
            rowOf[String(reg[0])] = all.length;
            all.push(row);
          } else all[i] = row;
          saved++;
        });
        _rankEvent(all, evId);
        _writeResults(sh, all);
      } finally {
        lock.releaseLock();
      }
      _audit("SAVE_RESULTS", body, "", errors.length ? "PARTIAL" : "OK", { saved, errors: errors.length });
      return { saved, errors, warnings };
    }
    function deleteResult(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var regId = String(body.registration_id || "");
      var lock = LockService2.getScriptLock();
      if (!lock.tryLock(2e4)) throw new Error("ລະບົບກຳລັງຫຍຸ້ງ — ລອງໃໝ່");
      try {
        _rows(SN.REGISTRATIONS).rows.forEach(function(r) {
          _resEv[String(r[0])] = String(r[2]);
        });
        var sh = _ensureSheet(SN.RESULTS);
        var all = sh.getDataRange().getValues().slice(1).filter(function(r) {
          return r[0] && String(r[1]) !== regId;
        });
        var evId = _resEv[regId] || String(body.event_id || "");
        _rankEvent(all, evId);
        _writeResults(sh, all);
      } finally {
        lock.releaseLock();
      }
      body.event_id = _resEv[regId] || body.event_id;
      _audit("DELETE_RESULT", body, regId, "OK", null);
      return { ok: true };
    }
    function publishResults(body) {
      if (!_isAdmin(body.token)) throw new Error("ADMIN_AUTH");
      var evId = String(body.event_id || "");
      if (!evId) throw new Error("event_id required");
      if (body.published) _props().setProperty("RESULTS_PUB_" + evId, "1");
      else _props().deleteProperty("RESULTS_PUB_" + evId);
      _audit(body.published ? "PUBLISH_RESULTS" : "UNPUBLISH_RESULTS", body, "", "OK", null);
      return { ok: true, published: !!body.published };
    }
    function getResults(params) {
      var evId = String(params.event_id || "");
      if (!evId) throw new Error("event_id required");
      var ev = null;
      _rows(SN.EVENTS).rows.some(function(e) {
        if (String(e[0]) === evId) {
          ev = e;
          return true;
        }
      });
      if (!ev) throw new Error("ບໍ່ພົບງານນີ້");
      var admin = _isAdmin(params.token), published = _resPublished(evId);
      var out = { event: _evPublic(ev), published };
      var C = _rows(SN.CATEGORIES).rows.filter(function(r) {
        return r[0] && String(r[1]) === evId;
      });
      out.categories = C.map(function(r) {
        var o = { category_id: r[0], category_name: r[3], distance: r[5] };
        if (admin) o.start_time = _props().getProperty("RES_START_" + r[0]) || "";
        return o;
      });
      if (!published && !admin) {
        out.results = [];
        return out;
      }
      var catMap = {};
      C.forEach(function(r) {
        catMap[String(r[0])] = r;
      });
      var partMap = {};
      _rows(SN.PARTICIPANTS).rows.forEach(function(r) {
        if (r[0]) partMap[String(r[0])] = r;
      });
      var regMap = {};
      _rows(SN.REGISTRATIONS).rows.forEach(function(r) {
        if (r[0] && String(r[2]) === evId) regMap[String(r[0])] = r;
      });
      var list = _rows(SN.RESULTS).rows.filter(function(r) {
        return r[0] && regMap[String(r[1])];
      }).map(function(r) {
        var reg = regMap[String(r[1])], part = partMap[String(reg[3])] || [], cat = catMap[String(r[2])] || [];
        var o = {
          registration_id: admin ? reg[0] : void 0,
          reg_number: reg[1],
          bib_number: r[3],
          first_name: part[2] || "",
          last_name: part[3] || "",
          nickname: part[4] || "",
          gender: String(part[5] || "").toLowerCase(),
          category_id: r[2],
          category_name: cat[3] || "",
          distance: cat[5] || "",
          start_time: _timeTxt(r[4]),
          finish_time: _timeTxt(r[5]),
          elapsed_time: _timeTxt(r[6]),
          overall_rank: r[7],
          category_rank: r[8],
          status: r[9]
        };
        o._s = String(r[9]) === "FINISHED" ? _secs(r[6]) : null;
        return o;
      });
      var groups = {};
      list.forEach(function(o) {
        if (o._s !== null && o.gender) (groups[o.category_id + "|" + o.gender] = groups[o.category_id + "|" + o.gender] || []).push(o);
      });
      Object.keys(groups).forEach(function(k) {
        var g = groups[k].sort(function(x, y) {
          return x._s - y._s;
        });
        g.forEach(function(o, i) {
          o.gender_rank = i > 0 && g[i - 1]._s === o._s ? g[i - 1].gender_rank : i + 1;
        });
      });
      var order = { FINISHED: 0, DSQ: 1, DNF: 2, DNS: 3 };
      list.sort(function(x, y) {
        return String(x.category_name).localeCompare(String(y.category_name)) || order[x.status] - order[y.status] || (x._s || 0) - (y._s || 0) || (parseInt(x.bib_number) || 0) - (parseInt(y.bib_number) || 0);
      });
      list.forEach(function(o) {
        delete o._s;
        if (!admin) delete o.registration_id;
      });
      var q = String(params.search || "").toLowerCase().trim();
      if (q) list = list.filter(function(o) {
        return (o.first_name + " " + o.last_name + " " + o.nickname).toLowerCase().indexOf(q) > -1 || /^\d+$/.test(q) && _bibNum(o.bib_number) === parseInt(q, 10) || String(o.reg_number).toLowerCase() === q;
      });
      out.results = list;
      out.finished = list.filter(function(o) {
        return o.status === "FINISHED";
      }).length;
      if (admin) {
        var has = {};
        list.forEach(function(o) {
          has[o.registration_id] = 1;
        });
        out.missing = Object.keys(regMap).map(function(k) {
          return regMap[k];
        }).filter(function(r) {
          return !has[r[0]] && String(r[10]).toUpperCase() === "PAID" && String(r[11]).toUpperCase() !== "CANCELLED";
        }).map(function(r) {
          var part = partMap[String(r[3])] || [], cat = catMap[String(r[4])] || [];
          return { registration_id: r[0], bib_number: r[5], first_name: part[2] || "", last_name: part[3] || "", category_id: r[4], category_name: cat[3] || "", checked_in: String(r[12]).toUpperCase() === "CHECKED_IN" };
        }).sort(function(x, y) {
          return y.checked_in - x.checked_in || (parseInt(x.bib_number) || 0) - (parseInt(y.bib_number) || 0);
        });
      }
      return out;
    }
    return {
      handleGet: async function(e) {
        if (!_auth(e)) return _err(401, "Unauthorized");
        var action = String(e.parameter.action || "").trim();
        try {
          switch (action) {
            case "evt.getEvents":
              return _ok(await getEvents(e.parameter));
            case "evt.getEvent":
              return _ok(await getEvent(e.parameter));
            case "evt.getRegistration":
              return _ok(await getRegistration(e.parameter));
            case "evt.getResults":
              return _ok(await getResults(e.parameter));
            default:
              return null;
          }
        } catch (ex) {
          return _err(500, ex.message);
        }
      },
      handlePost: async function(e) {
        if (!_auth(e)) return _err(401, "Unauthorized");
        var body;
        try {
          body = JSON.parse(e.postData.contents);
        } catch (_) {
          return _err(400, "Invalid JSON");
        }
        var action = String(body.action || "").trim();
        try {
          switch (action) {
            case "evt.createEvent":
              return _ok(await createEvent(body));
            case "evt.updateEvent":
              return _ok(await updateEvent(body));
            case "evt.updateEventStatus":
              return _ok(await updateEventStatus(body));
            case "evt.createCategory":
              return _ok(await createCategory(body));
            case "evt.updateCategory":
              return _ok(await updateCategory(body));
            case "evt.createRegistration":
              return _ok(await createRegistration(body));
            case "evt.submitPayment":
              return _ok(await submitPayment(body));
            case "evt.verifyPayment":
              return _ok(await verifyPayment(body));
            case "evt.assignBib":
              return _ok(await assignBib(body));
            case "evt.renumberBibs":
              return _ok(await renumberBibs(body));
            case "evt.checkIn":
              return _ok(await checkIn(body));
            case "evt.undoCheckIn":
              return _ok(await undoCheckIn(body));
            case "evt.updateParticipant":
              return _ok(await updateParticipant(body));
            case "evt.logExport":
              return _ok(await logExport(body));
            case "evt.getParticipants":
              return _ok(await getParticipants(body));
            case "evt.getEventStats":
              return _ok(await getEventStats(body));
            case "evt.adminSummary":
              return _ok(await adminSummary(body));
            case "evt.cancelRegistration":
              return _ok(await cancelRegistration(body));
            case "evt.getMyEvents":
              return _ok(await getMyEvents(body));
            case "evt.findRegistration":
              return _ok(await findRegistration(body));
            case "evt.deleteEvent":
              return _ok(await deleteEvent(body));
            case "evt.deleteCategory":
              return _ok(await deleteCategory(body));
            case "evt.uploadCover":
              return _ok(await uploadCover(body));
            case "evt.saveResults":
              return _ok(await saveResults(body));
            case "evt.deleteResult":
              return _ok(await deleteResult(body));
            case "evt.publishResults":
              return _ok(await publishResults(body));
            default:
              return null;
          }
        } catch (ex) {
          return _err(500, ex.message);
        }
      },
      setup: setupEventSheets2,
      repairSheets: function() {
        EVT_SHEETS.forEach(function(n) {
          _ensureSheet(n);
        });
      },
      sheetId: EVT_SHEET_ID,
      sheetNames: EVT_SHEETS
    };
  }();
  async function doGet(e) {
    var r = await _EVT_.handleGet(e);
    return r || await _WEB_.handleGet(e);
  }
  async function doPost(e) {
    var r = await _EVT_.handlePost(e);
    return r || await _WEB_.handlePost(e);
  }
  var WEB_LIMITS2 = {
    "createSale": [5, 3600, 60, 3600],
    "createRepair": [5, 86400, 60, 3600],
    "createBooking": [5, 86400, 40, 3600],
    "filmRequest": [5, 86400, 40, 3600],
    "registerCustomer": [3, 86400, 30, 3600],
    "evt.createRegistration": [10, 3600, 300, 3600],
    "evt.submitPayment": [10, 3600, 200, 3600]
  };
  function _webGuard_(e) {
    var raw = e && e.postData && e.postData.contents, body;
    try {
      body = JSON.parse(raw);
    } catch (x) {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    var action = String(body.action || "").trim(), lim = WEB_LIMITS2[action];
    if (!lim) return null;
    var who = body.customer || body.participant || body;
    var key = String(who && who.phone || "").replace(/\D/g, "").slice(-8) || String(body.qr_token || body.email || "").slice(0, 60);
    var c = CacheService.getScriptCache();
    function hit(k, max, sec) {
      var n = parseInt(c.get(k) || "0", 10);
      if (n >= max) return false;
      c.put(k, String(n + 1), sec);
      return true;
    }
    if (!hit("rl_all_" + action, lim[2], lim[3]) || key && !hit("rl_" + action + "_" + key, lim[0], lim[1])) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        code: 429,
        error: "ສົ່ງຫຼາຍເກີນໄປ — ກະລຸນາລໍຖ້າສັກຄູ່ ຫຼື ຕິດຕໍ່ຮ້ານທາງ WhatsApp"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    e.postData.contents = JSON.stringify(_webClean_(body, ""));
    return null;
  }
  function _webClean_(v, key) {
    if (typeof v === "string") {
      if (/image|base64|data_url|file/i.test(key)) return v;
      v = v.replace(/[<>]/g, "").slice(0, 3e3);
      if (/^[=@]/.test(v) || /^[+\-]\s*[A-Za-z(]/.test(v)) v = "'" + v;
      return v;
    }
    if (Array.isArray(v)) return v.slice(0, 100).map(function(x) {
      return _webClean_(x, key);
    });
    if (v && typeof v === "object") {
      var o = {};
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = _webClean_(v[k], k);
      return o;
    }
    return v;
  }
  function setupEventSheets() {
    var msg = _EVT_.setup();
    Logger.log(msg);
  }
  function testEventsApi() {
    Logger.log("--- evt.getEvents ---");
    var r = JSON.parse(_EVT_.handleGet({
      parameter: { action: "evt.getEvents", secret: "SDdMc3wNjJEevs60n2oMQeGnuI", status: "REGISTRATION_OPEN" },
      pathInfo: ""
    }).getContent());
    Logger.log(JSON.stringify(r));
  }
  function testBridge() {
    Logger.log("--- getSettings ---");
    Logger.log(JSON.stringify(_WEB_.handleGet({
      parameter: { action: "getSettings", secret: "open" },
      pathInfo: ""
    })));
  }
  function syncWebImages() {
    Logger.log(_WEB_.syncCategories());
    return _WEB_.syncImages();
  }
  function repairEventSheets() {
    _EVT_.repairSheets();
    Logger.log("ກວດຫົວຕາຕະລາງຊີດ Events ຄົບແລ້ວ — ເບິ່ງ log ຂ້າງເທິງ");
  }
  function snapshotPosImages() {
    Logger.log(_WEB_.snapshotPosImages());
  }
  function syncWebCategories() {
    Logger.log(_WEB_.syncCategories());
  }
  function installImageTrigger() {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (["syncWebImages", "warmWebCache"].indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger("syncWebImages").timeBased().everyMinutes(15).create();
    ScriptApp.newTrigger("warmWebCache").timeBased().everyMinutes(5).create();
    Logger.log("ຕັ້ງແລ້ວ: sync ຮູບທຸກ 15 ນາທີ + ອຸ່ນ cache ທຸກ 5 ນາທີ");
  }
  function warmWebCache() {
    var n = _WEB_.warmCache();
    Logger.log("cache ພ້ອມ: " + n + " ສິນຄ້າ");
  }
  function testImages() {
    var res = JSON.parse(_WEB_.handleGet({ parameter: { action: "getProducts", secret: "open", limit: "1000" }, pathInfo: "" }).getContent());
    var list = res.data && (res.data.data || res.data.products) || [];
    var withImg = list.filter(function(p) {
      return p.image;
    });
    Logger.log("ສິນຄ້າທັງໝົດ: " + list.length + " | ມີຮູບເທິງເວັບ: " + withImg.length);
    withImg.slice(0, 5).forEach(function(p) {
      Logger.log(p.sku + " → " + String(p.image).slice(0, 80));
    });
  }
  function clearWebCache() {
    _WEB_.clearCache();
    Logger.log("ລ້າງ cache ແລ້ວ — ເວັບຈະໂຫຼດຂໍ້ມູນໃໝ່");
  }
  function secureAllPasswords() {
    Logger.log("ເຂົ້າລະຫັດແລ້ວ: " + _WEB_.hashAllPasswords() + " ບັນຊີ");
  }
  function setAdminPassword() {
    var pw = "ໃສ່ລະຫັດໃໝ່ທີ່ນີ້";
    if (pw.length < 8 || pw === "ໃສ່ລະຫັດໃໝ່ທີ່ນີ້") throw new Error("ກະລຸນາແກ້ຄ່າ pw ໃຫ້ເປັນລະຫັດຂອງທ່ານ (8 ໂຕຂຶ້ນໄປ)");
    PropertiesService.getScriptProperties().setProperty("ADMIN_PW", _WEB_.hashPw(pw));
    Logger.log("ຕັ້ງລະຫັດແອັດມິນແລ້ວ — ລຶບລະຫັດອອກຈາກບັນທັດ var pw ແລ້ວກົດ Save");
  }
  function RepairQueueEngine_(ss) {
    var TZ = "Asia/Vientiane", Q_SHEET = "RepairQueue", CFG_SHEET = "RepairQueueConfig", JOBS = "RepairJobs";
    var HEAD = ["QueueID", "วันที่นัด", "ช่วงเวลา", "JobID", "ชื่อลูกค้า", "เบอร์โทร", "จักรยาน", "บริการ", "ที่มา", "สถานะคิว", "หมายเหตุ", "สร้างเมื่อ", "อัปเดต", "พร้อมรับ (ประมาณ)"];
    var STATUS = ["ยืนยันแล้ว", "มาแล้ว", "ไม่มา", "ยกเลิก"], USES = { "ยืนยันแล้ว": 1, "มาแล้ว": 1 };
    var JOB_DONE = /เสร็จแล้ว|รับรถคืนแล้ว|ยกเลิก|ຍົກເລີກ/, JOB_PAUSED = /รออะไหล่/;
    var DEF = {
      periods: [{ id: "am", start: "09:00", end: "12:00", cap: 2 }, { id: "pm", start: "13:00", end: "15:00", cap: 1 }, { id: "ev", start: "15:00", end: "18:00", cap: 1 }],
      days_ahead: 14,
      lead_min: 60,
      blocks: {},
      hours: null,
      day_hours: 8,
      slack_days: 1,
      default_hours: 2,
      off_days: [6],
      svc_sku: {},
      svc_hours: { "Basic": 1, "Standard": 3, "Ultimate": 16, "ซ่อมทั่วไป": 2 }
    };
    function hm(v) {
      if (v instanceof Date) return Utilities.formatDate(v, TZ, "HH:mm");
      v = String(v || "").trim();
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "";
    }
    function mins(t) {
      var p = String(t).split(":");
      return +p[0] * 60 + (+p[1] || 0);
    }
    function hhmm(m) {
      m = Math.round(m);
      return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + m % 60).slice(-2);
    }
    function today() {
      return Utilities.formatDate(/* @__PURE__ */ new Date(), TZ, "yyyy-MM-dd");
    }
    function nowMin() {
      return mins(Utilities.formatDate(/* @__PURE__ */ new Date(), TZ, "HH:mm"));
    }
    function ymd(v) {
      if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
      var s = String(v || "").trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
    }
    function addDays(d, n) {
      var x = /* @__PURE__ */ new Date(d + "T12:00:00+07:00");
      x.setUTCDate(x.getUTCDate() + n);
      return Utilities.formatDate(x, TZ, "yyyy-MM-dd");
    }
    function dow(d) {
      return (/* @__PURE__ */ new Date(d + "T12:00:00+07:00")).getUTCDay();
    }
    function intIn(v, lo, hi, dflt) {
      var n = parseInt(v, 10);
      return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
    }
    function numIn(v, lo, hi, dflt) {
      var n = parseFloat(v);
      return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, Math.round(n * 4) / 4));
    }
    function qSheet() {
      var sh = ss.getSheetByName(Q_SHEET);
      if (!sh) {
        sh = ss.insertSheet(Q_SHEET);
        sh.appendRow(HEAD);
        sh.getRange(1, 1, 1, HEAD.length).setFontWeight("bold");
        sh.setFrozenRows(1);
      } else if (!sh.getRange(1, HEAD.length).getValue()) sh.getRange(1, HEAD.length).setValue(HEAD[HEAD.length - 1]);
      return sh;
    }
    function normPeriods(list) {
      return DEF.periods.map(function(d) {
        var x = (list || []).filter(function(p) {
          return p && p.id === d.id;
        })[0] || d;
        var st = hm(x.start) || d.start, en = hm(x.end) || d.end;
        if (mins(st) >= mins(en)) throw new Error("ເວລາຊ່ວງ " + d.id + " ບໍ່ຖືກຕ້ອງ");
        return { id: d.id, start: st, end: en, cap: intIn(x.cap, 0, 20, d.cap) };
      });
    }
    function normSvc(o) {
      var out = {};
      Object.keys(o || {}).forEach(function(k) {
        var n = String(k).replace(/[<>]/g, "").trim().slice(0, 40);
        if (n) out[n] = numIn(o[k], 0.25, 200, 2);
      });
      return out;
    }
    function normSku(o) {
      var r = {};
      Object.keys(o || {}).forEach(function(k) {
        var n = String(k).replace(/[<>]/g, "").trim().slice(0, 40), v = String(o[k] || "").trim().slice(0, 60);
        if (n && v) r[n] = v;
      });
      return r;
    }
    function normOff(a) {
      var o = [];
      (a || []).forEach(function(x) {
        x = parseInt(x, 10);
        if (x >= 0 && x <= 6 && o.indexOf(x) < 0) o.push(x);
      });
      return o.sort();
    }
    function readRaw() {
      var sh = ss.getSheetByName(CFG_SHEET);
      if (sh && sh.getLastRow() >= 2) {
        try {
          return JSON.parse(String(sh.getRange(2, 1).getValue() || "{}")) || {};
        } catch (e) {
        }
      }
      try {
        return JSON.parse(PropertiesService.getScriptProperties().getProperty("QUEUE_CFG") || "{}") || {};
      } catch (e) {
        return {};
      }
    }
    function cfg() {
      var c = readRaw(), out = JSON.parse(JSON.stringify(DEF));
      try {
        if (Array.isArray(c.periods) && c.periods.length) out.periods = normPeriods(c.periods);
      } catch (e) {
      }
      if (c.days_ahead !== void 0) out.days_ahead = intIn(c.days_ahead, 1, 60, 14);
      if (c.lead_min !== void 0) out.lead_min = intIn(c.lead_min, 0, 2880, 60);
      if (c.blocks && typeof c.blocks === "object") out.blocks = c.blocks;
      if (Array.isArray(c.hours) && c.hours.length === 7) out.hours = c.hours;
      if (c.day_hours !== void 0) out.day_hours = numIn(c.day_hours, 1, 48, 8);
      if (c.slack_days !== void 0) out.slack_days = intIn(c.slack_days, 0, 14, 1);
      if (c.default_hours !== void 0) out.default_hours = numIn(c.default_hours, 0.25, 200, 2);
      if (Array.isArray(c.off_days)) out.off_days = normOff(c.off_days);
      if (c.svc_sku && typeof c.svc_sku === "object") out.svc_sku = normSku(c.svc_sku);
      if (c.svc_hours && typeof c.svc_hours === "object" && Object.keys(c.svc_hours).length) out.svc_hours = normSvc(c.svc_hours);
      return out;
    }
    function saveCfg(c) {
      var t = today(), b = {};
      Object.keys(c.blocks || {}).forEach(function(k) {
        if (k.slice(0, 10) >= t) b[k] = c.blocks[k];
      });
      c.blocks = b;
      var sh = ss.getSheetByName(CFG_SHEET);
      if (!sh) {
        sh = ss.insertSheet(CFG_SHEET);
        sh.getRange(1, 1).setValue("ตั้งค่าคิวซ่อม (JSON) — แก้ผ่านหน้าแอดมินเว็บ หรือ POS → งานซ่อม → ตารางคิว เท่านั้น");
        try {
          sh.hideSheet();
        } catch (e) {
        }
      }
      sh.getRange(2, 1).setValue(JSON.stringify({
        periods: c.periods,
        days_ahead: c.days_ahead,
        lead_min: c.lead_min,
        blocks: c.blocks,
        hours: c.hours || null,
        day_hours: c.day_hours,
        slack_days: c.slack_days,
        default_hours: c.default_hours,
        off_days: c.off_days,
        svc_sku: c.svc_sku,
        svc_hours: c.svc_hours
      }));
      return c;
    }
    function publicCfg(c) {
      return {
        periods: c.periods,
        days_ahead: c.days_ahead,
        lead_min: c.lead_min,
        blocks: c.blocks,
        day_hours: c.day_hours,
        slack_days: c.slack_days,
        default_hours: c.default_hours,
        off_days: c.off_days,
        svc_sku: c.svc_sku,
        svc_hours: c.svc_hours
      };
    }
    function svcHours(c, service, text) {
      var keys = Object.keys(c.svc_hours).sort(function(a, b) {
        return b.length - a.length;
      }), s = String(service || "").trim().toLowerCase();
      for (var i = 0; i < keys.length; i++) if (s && s === keys[i].toLowerCase()) return c.svc_hours[keys[i]];
      var t = (s + " " + String(text || "")).toLowerCase();
      for (var j = 0; j < keys.length; j++) if (t.indexOf(keys[j].toLowerCase()) >= 0) return c.svc_hours[keys[j]];
      return c.default_hours;
    }
    function rows() {
      var sh = qSheet(), last = sh.getLastRow();
      if (last < 2) return [];
      return sh.getRange(2, 1, last - 1, HEAD.length).getValues().map(function(r, i) {
        return {
          row: i + 2,
          id: String(r[0]),
          date: ymd(r[1]),
          period: String(r[2]),
          job_id: String(r[3] || ""),
          name: String(r[4] || ""),
          phone: String(r[5] || ""),
          bike: String(r[6] || ""),
          service: String(r[7] || ""),
          source: String(r[8] || ""),
          status: String(r[9] || ""),
          note: String(r[10] || ""),
          created: r[11] instanceof Date ? r[11].getTime() : 0,
          ready_saved: String(r[13] || "")
        };
      }).filter(function(q) {
        return q.id && q.date;
      });
    }
    function periodOf(c, t) {
      var m = mins(t), P = c.periods;
      for (var i = 0; i < P.length; i++) if (m < mins(P[i].end)) return P[i].id;
      return P[P.length - 1].id;
    }
    function posJobs() {
      var map = {}, sh = ss.getSheetByName(JOBS);
      if (!sh || sh.getLastRow() < 2) return map;
      sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues().forEach(function(r, i) {
        var id = String(r[0] || "");
        if (!id) return;
        map[id] = {
          row: i + 2,
          id,
          created: r[1] instanceof Date ? r[1] : null,
          name: String(r[2] || ""),
          phone: String(r[3] || ""),
          bike: String(r[4] || ""),
          problem: String(r[5] || ""),
          status: String(r[6] || ""),
          appt: r[11],
          web: /^RE-/.test(id) || String(r[15]) === "website"
        };
      });
      return map;
    }
    function dayFn(c, hours) {
      var H = Array.isArray(hours) && hours.length === 7 ? hours : c.hours, cache = {};
      var L = c.periods.reduce(function(a, p) {
        return a + (p.cap > 0 ? mins(p.end) - mins(p.start) : 0);
      }, 0) || 1;
      return function(d) {
        if (cache[d]) return cache[d];
        var w = dow(d), h = H ? H[w] || {} : { closed: false, open: "09:00", close: "18:00" };
        var open = hm(h.open) || "09:00", close = hm(h.close) || "18:00", db = c.blocks[d] || null, off = (c.off_days || []).indexOf(w) >= 0;
        var closed = !!(h.closed || off || db && db.closed);
        var P = c.periods.map(function(p) {
          var b = c.blocks[d + "|" + p.id] || null, cap = b && b.cap !== void 0 && b.cap !== "" ? +b.cap : p.cap;
          var inHours = !h.closed && mins(p.start) >= mins(open) && mins(p.start) < mins(close);
          var end = mins(close) < mins(p.end) ? close : p.end, off2 = closed || !inHours || !!(b && b.closed);
          var work = off2 || p.cap <= 0 ? 0 : c.day_hours * (mins(end) - mins(p.start)) / L;
          return { id: p.id, start: p.start, end, cap, off: off2 || cap <= 0, work, reason: b ? String(b.reason || "") : "" };
        });
        return cache[d] = {
          date: d,
          dow: w,
          closed,
          reason: db ? String(db.reason || "") : off ? "off" : h.closed ? "hours" : "",
          periods: P,
          work: P.reduce(function(a, p) {
            return a + p.work;
          }, 0)
        };
      };
    }
    function allocate(day, used, job, commit2) {
      var rem = job.hours, d = job.date, P0 = day(d).periods, pi = Math.max(0, P0.map(function(p2) {
        return p2.id;
      }).indexOf(job.period)), first = true;
      for (var n = 0; n < 240; n++) {
        var D = day(d);
        for (; pi < D.periods.length; pi++) {
          var p = D.periods[pi], key = d + "|" + p.id, u = used[key] || 0, len = mins(p.end) - mins(p.start);
          if (p.work <= 0 || len <= 0) {
            first = false;
            continue;
          }
          var startM = mins(p.start), avail = p.work - u;
          if (first && job.fromMin && job.fromMin > startM) {
            var f = Math.max(0, (mins(p.end) - job.fromMin) / len);
            avail = Math.min(avail, p.work * f);
          }
          first = false;
          if (avail <= 1e-6) continue;
          var take = Math.min(avail, rem);
          if (commit2) used[key] = u + take;
          rem -= take;
          if (rem <= 1e-6) {
            var at = startM + (u + take) / p.work * len;
            return { date: d, period: p.id, time: hhmm(Math.ceil(Math.min(at, mins(p.end)) / 15) * 15) };
          }
        }
        d = addDays(d, 1);
        pi = 0;
      }
      return null;
    }
    function workload(c, ALL, JOBMAP, exclude) {
      var t = today(), floor = addDays(t, -30), list = [], linked = {};
      ALL.forEach(function(q) {
        if (q.job_id) linked[q.job_id] = 1;
      });
      ALL.forEach(function(q) {
        if (q.id === exclude || !USES[q.status] || q.date < floor) return;
        var j = JOBMAP[q.job_id];
        if (j && (JOB_DONE.test(j.status) || JOB_PAUSED.test(j.status))) return;
        list.push({ id: q.id, date: q.date, period: q.period, hours: svcHours(c, q.service, (j ? j.problem : "") + " " + q.note), order: q.created || (/* @__PURE__ */ new Date(q.date + "T08:00:00+07:00")).getTime() });
      });
      Object.keys(JOBMAP).forEach(function(id) {
        var j = JOBMAP[id];
        if (linked[id] || j.web || !j.created || JOB_DONE.test(j.status) || JOB_PAUSED.test(j.status)) return;
        var d = Utilities.formatDate(j.created, TZ, "yyyy-MM-dd");
        if (d < floor) return;
        var tm = Utilities.formatDate(j.created, TZ, "HH:mm");
        list.push({ id: "POS-" + id, date: d, period: periodOf(c, tm), fromMin: mins(tm), hours: svcHours(c, "", j.problem), order: j.created.getTime() });
      });
      return list.sort(function(a, b) {
        return a.order - b.order;
      });
    }
    function plan(c, hours, ALL, JOBMAP, exclude) {
      var day = dayFn(c, hours), used = {}, done = {}, list = workload(c, ALL, JOBMAP, exclude);
      list.forEach(function(j) {
        done[j.id] = allocate(day, used, j, true);
        j.ready = done[j.id];
      });
      return { day, used, ready: done, list };
    }
    function trial(c, PL, d, period, H, fromMin) {
      var r = allocate(PL.day, PL.used, { date: d, period, hours: H, fromMin }, false);
      if (!r) return { ok: false, ready: null };
      var need = Math.max(1, Math.ceil(H / c.day_hours - 1e-9)) + c.slack_days, x = d, cnt = 0, deadline = d;
      for (var i = 0; i < 120 && cnt < need; i++) {
        if (PL.day(x).work > 0 || i === 0) {
          cnt++;
          deadline = x;
        }
        x = addDays(x, 1);
      }
      return { ok: r.date <= deadline, ready: r, deadline };
    }
    function grid(from, days, withEntries, hours, opt) {
      opt = opt || {};
      var c = cfg(), to = addDays(from, days - 1), ALL = rows(), JOBMAP = posJobs(), R = ALL.filter(function(q) {
        return q.date >= from && q.date <= to;
      });
      var linked = {};
      ALL.forEach(function(q) {
        if (q.job_id) linked[q.job_id] = 1;
      });
      var PL = plan(c, hours, ALL, JOBMAP, opt.exclude), bikes = {}, walk = [];
      R.forEach(function(q) {
        if (USES[q.status]) bikes[q.date + "|" + q.period] = (bikes[q.date + "|" + q.period] || 0) + 1;
      });
      Object.keys(JOBMAP).forEach(function(id) {
        var j = JOBMAP[id];
        if (linked[id] || j.web || !j.created || /ยกเลิก|ຍົກເລີກ/.test(j.status)) return;
        var d2 = Utilities.formatDate(j.created, TZ, "yyyy-MM-dd");
        if (d2 < from || d2 > to) return;
        var tm = Utilities.formatDate(j.created, TZ, "HH:mm"), p = periodOf(c, tm);
        bikes[d2 + "|" + p] = (bikes[d2 + "|" + p] || 0) + 1;
        walk.push({
          id: "POS-" + id,
          date: d2,
          period: p,
          job_id: id,
          name: j.name,
          phone: j.phone,
          bike: j.bike,
          service: j.problem,
          source: "POS",
          status: "มาแล้ว",
          job_status: j.status,
          time: tm,
          hours: svcHours(c, "", j.problem),
          ready: PL.ready["POS-" + id] || null
        });
      });
      var H = opt.service !== void 0 && opt.service !== null && opt.service !== "" ? svcHours(c, opt.service, "") : 0;
      var nowD = today(), nowM = nowMin(), out = [];
      for (var i = 0; i < days; i++) {
        var d = addDays(from, i), D = PL.day(d), usedH = 0;
        var day = { date: d, dow: D.dow, closed: D.closed, reason: D.reason, periods: [] };
        D.periods.forEach(function(p) {
          var u = bikes[d + "|" + p.id] || 0, st;
          usedH += PL.used[d + "|" + p.id] || 0;
          if (p.off) st = "closed";
          else if (d < nowD || d === nowD && nowM + c.lead_min >= mins(p.end)) st = "past";
          else if (u >= p.cap) st = "full";
          else st = "open";
          var o = { id: p.id, start: p.start, end: p.end, cap: p.cap, used: u, left: Math.max(0, p.cap - u), status: st, reason: p.reason };
          if (H && st === "open") {
            var tr = trial(c, PL, d, p.id, H, d === nowD ? Math.max(nowM, mins(p.start)) : 0);
            if (!tr.ok) o.status = "busy";
            if (tr.ready) o.ready = tr.ready;
          }
          day.periods.push(o);
        });
        day.work = { cap: Math.round(D.work * 4) / 4, used: Math.round(usedH * 4) / 4, free: Math.max(0, Math.round((D.work - usedH) * 4) / 4) };
        out.push(day);
      }
      var res = {
        from,
        days: out,
        periods: c.periods.map(function(p) {
          return { id: p.id, start: p.start, end: p.end };
        }),
        days_ahead: c.days_ahead,
        day_hours: c.day_hours,
        service_hours: H || void 0
      };
      if (withEntries) {
        res.entries = R.map(function(q) {
          var j = JOBMAP[q.job_id];
          return {
            id: q.id,
            date: q.date,
            period: q.period,
            job_id: q.job_id,
            name: q.name,
            phone: q.phone,
            bike: q.bike,
            service: q.service,
            source: q.source,
            status: q.status,
            note: q.note,
            job_status: j ? j.status : "",
            hours: svcHours(c, q.service, (j ? j.problem : "") + " " + q.note),
            ready: PL.ready[q.id] || null
          };
        }).concat(walk);
        res.config = publicCfg(c);
      }
      return res;
    }
    function slot(date, period, hours, opt) {
      var p = grid(date, 1, false, hours, opt).days[0].periods.filter(function(x) {
        return x.id === period;
      })[0];
      if (!p) throw new Error("ຊ່ວງເວລາບໍ່ຖືກຕ້ອງ");
      return p;
    }
    function readyText(r) {
      return r ? r.date + " " + r.time : "";
    }
    function readyDate(r) {
      return r ? /* @__PURE__ */ new Date(r.date + "T" + r.time + ":00+07:00") : "";
    }
    function setJobReady(jobId, r, prevText) {
      if (!jobId || !r) return;
      try {
        var j = posJobs()[jobId];
        if (!j) return;
        var cur = j.appt instanceof Date ? Utilities.formatDate(j.appt, TZ, "yyyy-MM-dd HH:mm") : String(j.appt || "");
        if (cur && cur !== prevText) return;
        ss.getSheetByName(JOBS).getRange(j.row, 12).setValue(readyDate(r));
      } catch (e) {
        Logger.log("queue setJobReady: " + e.message);
      }
    }
    function newId() {
      return "Q-" + Utilities.formatDate(/* @__PURE__ */ new Date(), TZ, "yyMMdd") + "-" + String(Date.now()).slice(-5) + Math.floor(Math.random() * 10);
    }
    function book(o, makeJob, hours) {
      var date = ymd(o.date), period = String(o.period || "");
      if (!date) throw new Error("date required");
      var lock = LockService.getScriptLock();
      lock.waitLock(2e4);
      try {
        var c = cfg(), H = svcHours(c, o.service, o.note), p;
        if (o.arrived) p = { start: "", end: "" };
        else {
          p = slot(date, period, hours);
          if (!o.force && p.status !== "open") throw new Error(p.status === "full" ? "QUEUE_FULL: ຊ່ວງເວລານີ້ເຕັມແລ້ວ — ກະລຸນາເລືອກເວລາອື່ນ" : "QUEUE_CLOSED: ຊ່ວງເວລານີ້ບໍ່ຮັບຈອງ — ກະລຸນາເລືອກເວລາອື່ນ");
          var PL0 = plan(c, hours, rows(), posJobs()), tr = trial(c, PL0, date, period, H, date === today() ? Math.max(nowMin(), mins(p.start)) : 0);
          if (!o.force && !tr.ok) throw new Error("QUEUE_BUSY: ຊ່າງເຕັມ — ງານນີ້ໃຊ້ເວລາ " + H + " ຊົ່ວໂມງ ສຳເລັດບໍ່ທັນ. ກະລຸນາເລືອກມື້ອື່ນ");
        }
        var job = o.job_id ? { job_id: o.job_id } : makeJob();
        var id = newId(), now = /* @__PURE__ */ new Date();
        qSheet().appendRow([
          id,
          "'" + date,
          period,
          job.job_id || "",
          o.name || "",
          "'" + String(o.phone || ""),
          o.bike || "",
          o.service || "",
          o.source || "",
          o.arrived ? "มาแล้ว" : "ยืนยันแล้ว",
          String(o.note || "").slice(0, 300),
          now,
          now,
          ""
        ]);
        var PL = plan(c, hours, rows(), posJobs()), r = PL.ready[id] || null, sh = qSheet();
        if (r) {
          sh.getRange(sh.getLastRow(), 14).setValue("'" + readyText(r));
          setJobReady(job.job_id, r, "");
        }
        job.queue = { id, date, period, start: p.start, end: p.end, hours: H, ready: r };
        return job;
      } finally {
        lock.releaseLock();
      }
    }
    function estimate(service, date, period, hours) {
      var c = cfg(), H = svcHours(c, service, ""), t = today(), d = ymd(date) || t;
      var pr = period || periodOf(c, hhmm(nowMin())), PL = plan(c, hours, rows(), posJobs());
      var tr = trial(c, PL, d, pr, H, d === t ? nowMin() : 0);
      return { hours: H, ready: tr.ready, ok: tr.ok, deadline: tr.deadline };
    }
    function jobNote(jobId, txt) {
      if (!jobId) return;
      try {
        var sh = ss.getSheetByName(JOBS);
        if (!sh || sh.getLastRow() < 2) return;
        var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === jobId) {
          var cell = sh.getRange(i + 2, 14), v = String(cell.getValue() || "");
          cell.setValue((v ? v + " | " : "") + "[" + Utilities.formatDate(/* @__PURE__ */ new Date(), TZ, "dd/MM HH:mm") + "] " + txt);
          return;
        }
      } catch (e) {
        Logger.log("queue jobNote: " + e.message);
      }
    }
    function update(o, hours) {
      var lock = LockService.getScriptLock();
      lock.waitLock(2e4);
      try {
        var q = rows().filter(function(x) {
          return x.id === String(o.id);
        })[0];
        if (!q) throw new Error("ບໍ່ພົບຄິວ " + o.id);
        var sh = qSheet(), c = cfg();
        if (o.date || o.period) {
          var nd = ymd(o.date) || q.date, np = String(o.period || q.period);
          if (nd !== q.date || np !== q.period) {
            var p = slot(nd, np, hours, { exclude: q.id });
            if (!o.force && (p.status === "closed" || p.used >= p.cap)) throw new Error("QUEUE_FULL: ຊ່ວງທີ່ຈະຍ້າຍໄປເຕັມ ຫຼື ປິດ");
            if (!o.force) {
              var PL0 = plan(c, hours, rows(), posJobs(), q.id), tr = trial(c, PL0, nd, np, svcHours(c, q.service, q.note), 0);
              if (!tr.ok) throw new Error("QUEUE_BUSY: ຊ່າງເຕັມ — ງານນີ້ສຳເລັດບໍ່ທັນໃນວັນທີ່ຈະຍ້າຍໄປ");
            }
            sh.getRange(q.row, 2, 1, 2).setValues([["'" + nd, np]]);
            jobNote(q.job_id, "ย้ายคิว → " + nd + " " + np);
          }
        }
        if (o.status) {
          if (STATUS.indexOf(o.status) < 0) throw new Error("status");
          sh.getRange(q.row, 10).setValue(o.status);
          if (o.status === "ยกเลิก" || o.status === "ไม่มา") jobNote(q.job_id, "คิว: " + o.status);
        }
        if (o.note !== void 0) sh.getRange(q.row, 11).setValue(String(o.note).slice(0, 300));
        sh.getRange(q.row, 13).setValue(/* @__PURE__ */ new Date());
        if (o.date || o.period) {
          var r = plan(c, hours, rows(), posJobs()).ready[q.id] || null;
          if (r) {
            sh.getRange(q.row, 14).setValue("'" + readyText(r));
            setJobReady(q.job_id, r, q.ready_saved);
          }
        }
        return { ok: true };
      } finally {
        lock.releaseLock();
      }
    }
    function block(o) {
      var d = ymd(o.date);
      if (!d) throw new Error("date required");
      var key = o.period ? d + "|" + String(o.period) : d, c = cfg(), v = {};
      if (o.closed) v.closed = true;
      if (o.cap !== void 0 && o.cap !== "" && o.cap !== null) v.cap = intIn(o.cap, 0, 20, 0);
      if (o.reason) v.reason = String(o.reason).replace(/[<>]/g, "").slice(0, 80);
      if (v.closed || v.cap !== void 0) c.blocks[key] = v;
      else delete c.blocks[key];
      saveCfg(c);
      return { ok: true, blocks: c.blocks };
    }
    function setConfig(o) {
      var c = cfg();
      if (Array.isArray(o.periods)) c.periods = normPeriods(o.periods);
      if (o.days_ahead !== void 0) c.days_ahead = intIn(o.days_ahead, 1, 60, 14);
      if (o.lead_min !== void 0) c.lead_min = intIn(o.lead_min, 0, 2880, 60);
      if (Array.isArray(o.hours) && o.hours.length === 7) c.hours = o.hours;
      if (o.day_hours !== void 0) c.day_hours = numIn(o.day_hours, 1, 48, 8);
      if (o.slack_days !== void 0) c.slack_days = intIn(o.slack_days, 0, 14, 1);
      if (o.default_hours !== void 0) c.default_hours = numIn(o.default_hours, 0.25, 200, 2);
      if (Array.isArray(o.off_days)) c.off_days = normOff(o.off_days);
      if (o.svc_sku && typeof o.svc_sku === "object") c.svc_sku = normSku(o.svc_sku);
      if (o.svc_hours && typeof o.svc_hours === "object") {
        var s = normSvc(o.svc_hours);
        if (Object.keys(s).length) c.svc_hours = s;
      }
      saveCfg(c);
      return publicCfg(c);
    }
    function byJob() {
      var m = {};
      rows().forEach(function(q) {
        if (q.job_id && q.status !== "ยกเลิก") m[q.job_id] = { id: q.id, date: q.date, period: q.period, status: q.status, source: q.source, ready: q.ready_saved };
      });
      return m;
    }
    function svcSku(service) {
      var m = cfg().svc_sku || {}, s = String(service || "").trim().toLowerCase();
      for (var k in m) if (k.toLowerCase() === s) return m[k];
      return "";
    }
    return {
      svcSku,
      cfg,
      saveCfg,
      grid,
      slot,
      book,
      estimate,
      update,
      block,
      setConfig,
      byJob,
      svcHours: function(s, t) {
        return svcHours(cfg(), s, t);
      },
      jobNote,
      today,
      ymd,
      addDays,
      STATUS
    };
  }
  return { doGet, doPost };
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400"
};
const json = (o, status) => new Response(typeof o === "string" ? o : JSON.stringify(o), { status: status || 200, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
async function runOnce(e, method, action, need) {
  const ctx = await makeCtx(need);
  const app = makeApp(ctx);
  const out = method === "GET" ? await app.doGet(e) : await app.doPost(e);
  const s = out && out.s ? out.s : JSON.stringify({ ok: false, error: "No response", code: 500 });
  let ok = false;
  try {
    ok = JSON.parse(s).ok === true;
  } catch (_) {
  }
  const miss = !ok && (s.match(/PRELOAD_MISSING:(sheet:)?([\w.]+)/) || null);
  if (miss && !ctx.wrote) return { retry: miss };
  await commit(ctx, ok);
  return { body: s, ctx };
}
async function handle(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url), method = req.method === "GET" ? "GET" : "POST";
  const parameter = Object.fromEntries(url.searchParams.entries());
  let raw = "", body = {};
  if (method === "POST") {
    raw = await req.text();
    try {
      body = JSON.parse(raw || "{}");
    } catch (_) {
      return json({ ok: false, error: "Invalid JSON", code: 400 });
    }
  }
  const action = String((method === "GET" ? parameter.action : body.action) || "").trim();
  if (action === "ping" && !parameter.secret) return json({ ok: true, data: { status: "ok", version: "edge-2" } });
  if (action === "pos.productImage" && method === "POST") return posProductImage(body);
  try {
    if (method === "POST" && WEB_LIMITS[action]) {
      if (!await guard(action, body)) return json({ ok: false, code: 429, error: "ສົ່ງຫຼາຍເກີນໄປ — ກະລຸນາລໍຖ້າສັກຄູ່ ຫຼື ຕິດຕໍ່ຮ້ານທາງ WhatsApp" });
      body = webClean(body, "");
      raw = JSON.stringify(body);
    }
    const e = { parameter, pathInfo: "", postData: method === "POST" ? { contents: raw, type: "text/plain" } : void 0 };
    const need = needsFor(action);
    for (let attempt = 0; attempt < 4; attempt++) {
      let r;
      try {
        r = await runOnce(e, method, action, need);
      } catch (err) {
        if (/EVT_CONFLICT/.test(err.message) && /^evt\./.test(action) && attempt < 2) continue;
        throw err;
      }
      if (r.retry) {
        const m = r.retry;
        if (m[1]) need.sheets = [...need.sheets || [], m[2]];
        else if (m[2] === "web_catalog") need.catalog = true;
        else if (m[2] === "web_queue_data") need.queue = true;
        else return json({ ok: false, error: "PRELOAD_MISSING " + m[2], code: 500 });
        continue;
      }
      if (/^evt\.getParticipants$/.test(action)) return json(await signSlips(r.body));
      return json(r.body);
    }
    return json({ ok: false, error: "ລະບົບຫຍຸ້ງ — ກະລຸນາລອງໃໝ່", code: 503 });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err), code: 500 });
  }
}
async function signSlips(body) {
  const ids = [...new Set(body.match(/sb:event-slips\/[^"\\]+/g) || [])];
  if (!ids.length) return body;
  const key = (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") : process.env.SUPABASE_SERVICE_ROLE_KEY) || "";
  try {
    const r = await fetch(SB_URL() + "/storage/v1/object/sign/event-slips", {
      method: "POST",
      headers: { authorization: "Bearer " + key, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, paths: ids.map((x) => x.slice("sb:event-slips/".length)) })
    });
    const list = await r.json();
    (Array.isArray(list) ? list : []).forEach((x, i) => {
      if (x && x.signedURL) body = body.split(ids[i]).join(SB_URL() + "/storage/v1" + x.signedURL);
    });
  } catch (e) {
    console.log("sign slips: " + e.message);
  }
  return body;
}
if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(handle);
async function posProductImage(b) {
  try {
    const token = String(b.token || ""), sku = String(b.sku || "").trim();
    if (!token || !sku) return json({ ok: false, error: "token / sku required", code: 400 });
    if (!b.data) {
      await rpcRaw("pos_product_image_set", { p_token: token, p_sku: sku, p_url: "" });
      return json({ ok: true, data: { url: "" } });
    }
    const m = String(b.data).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return json({ ok: false, error: "ໄຟລ໌ຕ້ອງເປັນຮູບ JPG / PNG / WebP", code: 400 });
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > 4 * 1024 * 1024) return json({ ok: false, error: "ຮູບໃຫຍ່ເກີນ 4MB", code: 400 });
    await rpcRaw("pos_product_image_check", { p_token: token, p_sku: sku });
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[m[1]];
    const key = "pos/" + sku.replace(/[^\w.-]+/g, "_").slice(0, 60) + "-" + Date.now().toString(36) + "." + ext;
    let url = "";
    const c = R2();
    if (c) {
      try {
        const r = await c.client.fetch(c.endpoint + "/" + c.bucket + "/" + key, {
          method: "PUT",
          body: bytes,
          headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable" }
        });
        if (r.ok) url = c.pub + "/" + key;
        else console.log("R2 " + r.status + " " + (await r.text()).slice(0, 200));
      } catch (e) {
        console.log("R2 error: " + e.message);
      }
    }
    if (!url) {
      const key2 = ENV("SUPABASE_SERVICE_ROLE_KEY");
      const r = await fetch(SB_URL() + "/storage/v1/object/web-media/" + key, {
        method: "POST",
        body: bytes,
        headers: { authorization: "Bearer " + key2, apikey: key2, "content-type": m[1], "x-upsert": "false" }
      });
      if (!r.ok) return json({ ok: false, error: "ອັບໂຫລດຮູບບໍ່ສຳເລັດ (" + r.status + ")", code: 502 });
      url = SB_URL() + "/storage/v1/object/public/web-media/" + key;
    }
    await rpcRaw("pos_product_image_set", { p_token: token, p_sku: sku, p_url: url });
    return json({ ok: true, data: { url } });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e), code: /SESSION_EXPIRED/.test(e && e.message) ? 401 : 500 });
  }
}
export {
  WEB_LIMITS,
  commit,
  guard,
  handle,
  makeCtx,
  makeEnv,
  needsFor,
  rpcRaw,
  webClean
};
