/* Sevenday — English calendar for every date field (website + POS)
   • Replaces the browser's own date picker (which follows the phone/PC language, e.g. Thai months / Buddhist year)
     with one English calendar: Mon–Sun, January–December, Gregorian years.
   • Works on <input type="date"> and <input type="datetime-local">, including fields added later.
   • The original input keeps its id and its value format (YYYY-MM-DD / YYYY-MM-DDTHH:mm), so existing code
     that reads or sets .value and listens to "change" keeps working.
   • Opt out for one field: add data-native-date. */
(function () {
  if (window.SDDatePicker) return;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON3 = MONTHS.map(function (m) { return m.slice(0, 3); });
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], HEAD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); };
  function parse(v) {
    var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3], t: m[4] ? m[4] + ':' + m[5] : '' } : null;
  }
  function todayParts() { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; }
  function dowOf(y, m, d) { return new Date(Date.UTC(y, m, d)).getUTCDay(); }
  function label(v, kind) {
    var p = parse(v); if (!p) return '';
    var s = DOW[dowOf(p.y, p.m, p.d)] + ', ' + p.d + ' ' + MON3[p.m] + ' ' + p.y;
    return kind === 'datetime-local' && p.t ? s + ' · ' + p.t : s;
  }

  var css = '' +
    '.sdp-field{cursor:pointer;caret-color:transparent}' +
    '.sdp-field::placeholder{color:#8a8a8a}' +
    '.sdp-pop{position:fixed;z-index:2147483000;width:296px;background:#fff;color:#111;border:1px solid #d4d4d4;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:10px;font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Lao","Noto Sans Thai",sans-serif}' +
    '.sdp-pop *{box-sizing:border-box;font-family:inherit}' +
    '.sdp-hd{display:flex;align-items:center;gap:4px;margin-bottom:8px}' +
    '.sdp-hd select{flex:1;height:32px;border:1px solid #d4d4d4;border-radius:8px;padding:0 6px;font-size:14px;font-weight:700;background:#fff;color:#111;margin:0;width:auto}' +
    '.sdp-nav{width:32px;height:32px;border:0;border-radius:8px;background:#f2f2f2;font-size:18px;font-weight:700;cursor:pointer;color:#111;padding:0}' +
    '.sdp-nav:hover{background:#e6e6e6}' +
    '.sdp-g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}' +
    '.sdp-g span{text-align:center;font-size:11.5px;font-weight:700;color:#777;padding:4px 0}' +
    '.sdp-g button{height:36px;border:0;border-radius:8px;background:none;cursor:pointer;font-size:14px;color:#111;padding:0}' +
    '.sdp-g button:hover{background:#f0f0f0}' +
    '.sdp-g button.o{color:#b5b5b5}' +
    '.sdp-g button.t{box-shadow:inset 0 0 0 1.5px #111;font-weight:700}' +
    '.sdp-g button.s{background:#111;color:#fff;font-weight:700}' +
    '.sdp-g button:disabled{color:#d0d0d0;cursor:not-allowed;background:none;text-decoration:line-through}' +
    '.sdp-ft{display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #eee}' +
    '.sdp-tm{display:inline-flex;align-items:center;gap:2px;font-weight:700}' +
    '.sdp-tm select{height:32px;border:1px solid #d4d4d4;border-radius:8px;padding:0 4px;font-size:14px;background:#fff;color:#111;margin:0;width:auto}' +
    '.sdp-ft .sp{flex:1}' +
    '.sdp-b{height:32px;border:1px solid #d4d4d4;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:700;padding:0 10px;color:#111}' +
    '.sdp-b.k{background:#111;border-color:#111;color:#fff}' +
    '@media (max-width:520px){.sdp-pop{left:8px!important;right:8px!important;width:auto!important;bottom:8px!important;top:auto!important}.sdp-g button{height:42px}}';
  function addCss() { if (document.getElementById('sdp-css')) return; var st = document.createElement('style'); st.id = 'sdp-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }

  var pop = null, cur = null;          // cur = { el, proxy, kind, y, m }
  function close() { if (pop) { pop.remove(); pop = null; } if (cur && cur.proxy) cur.proxy.setAttribute('aria-expanded', 'false'); cur = null; }
  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  function setVal(el, v) { VALUE.set.call(el, v); if (el._sdpRender) el._sdpRender(); fire(el); }

  function open(el) {
    if (el.disabled || el.readOnly) return;
    close(); addCss();
    var kind = el._sdpKind, t = todayParts();
    var base = parse(VALUE.get.call(el)) || clampToRange(el, t);
    cur = { el: el, proxy: el._sdpProxy, kind: kind, y: base.y, m: base.m, time: (parse(VALUE.get.call(el)) || {}).t || '09:00' };
    pop = document.createElement('div'); pop.className = 'sdp-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('translate', 'no'); pop.setAttribute('data-no-tr', '');
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep focus, no blur-close
    pop.addEventListener('click', onClick); pop.addEventListener('change', onChange);
    document.body.appendChild(pop);
    cur.proxy.setAttribute('aria-expanded', 'true');
    draw(); place();
  }
  function clampToRange(el, t) {
    var mn = parse(el.getAttribute('min')), mx = parse(el.getAttribute('max')), v = ymd(t.y, t.m, t.d);
    if (mx && v > ymd(mx.y, mx.m, mx.d)) return mx;
    if (mn && v < ymd(mn.y, mn.m, mn.d)) return mn;
    return t;
  }
  function place() {
    if (!pop || !cur) return;
    var r = cur.proxy.getBoundingClientRect(), h = pop.offsetHeight, w = pop.offsetWidth;
    var top = r.bottom + 6; if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    pop.style.top = Math.max(8, top) + 'px'; pop.style.left = left + 'px';
  }
  function draw() {
    var el = cur.el, y = cur.y, m = cur.m, v = parse(VALUE.get.call(el)), t = todayParts();
    var mn = el.getAttribute('min'), mx = el.getAttribute('max'); mn = mn ? mn.slice(0, 10) : ''; mx = mx ? mx.slice(0, 10) : '';
    var y0 = Math.min(t.y - 100, y - 5, mn ? +mn.slice(0, 4) : 9999), y1 = Math.max(t.y + 10, y + 5, mx ? +mx.slice(0, 4) : 0);
    if (mn) y0 = Math.max(y0, +mn.slice(0, 4)); if (mx) y1 = Math.min(y1, +mx.slice(0, 4));
    var years = ''; for (var yy = y1; yy >= y0; yy--) years += '<option value="' + yy + '"' + (yy === y ? ' selected' : '') + '>' + yy + '</option>';
    var h = '<div class="sdp-hd"><button type="button" class="sdp-nav" data-nav="-1" aria-label="Previous month">‹</button>' +
      '<select data-sel="m" aria-label="Month">' + MONTHS.map(function (n, i) { return '<option value="' + i + '"' + (i === m ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
      '<select data-sel="y" aria-label="Year">' + years + '</select>' +
      '<button type="button" class="sdp-nav" data-nav="1" aria-label="Next month">›</button></div><div class="sdp-g">' + HEAD.map(function (d) { return '<span>' + d + '</span>'; }).join('');
    var first = (dowOf(y, m, 1) + 6) % 7, start = new Date(Date.UTC(y, m, 1 - first));
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getTime() + i * 864e5), dy = d.getUTCFullYear(), dm = d.getUTCMonth(), dd = d.getUTCDate(), key = ymd(dy, dm, dd);
      var cls = (dm !== m ? 'o ' : '') + (dy === t.y && dm === t.m && dd === t.d ? 't ' : '') + (v && v.y === dy && v.m === dm && v.d === dd ? 's' : '');
      var off = (mn && key < mn) || (mx && key > mx);
      h += '<button type="button" data-day="' + key + '" class="' + cls + '"' + (off ? ' disabled' : '') + ' aria-label="' + DOW[d.getUTCDay()] + ' ' + dd + ' ' + MONTHS[dm] + ' ' + dy + '">' + dd + '</button>';
    }
    h += '</div><div class="sdp-ft">' + (cur.kind === 'datetime-local' ? timeSel(cur.time) : '') +
      '<button type="button" class="sdp-b" data-act="today">Today</button><span class="sp"></span>' +
      (el.required ? '' : '<button type="button" class="sdp-b" data-act="clear">Clear</button>') +
      (cur.kind === 'datetime-local' ? '<button type="button" class="sdp-b k" data-act="ok">OK</button>' : '') + '</div>';
    pop.innerHTML = h;
  }
  // ເວລາແບບ 24 ຊົ່ວໂມງ (ບໍ່ຂຶ້ນກັບພາສາຂອງເຄື່ອງ)
  function timeSel(t) {
    var p = String(t || '09:00').split(':'), hh = +p[0] || 0, mm = +p[1] || 0, o = '<span class="sdp-tm" data-time-box><select data-hh aria-label="Hour">';
    for (var i = 0; i < 24; i++) o += '<option' + (i === hh ? ' selected' : '') + '>' + pad(i) + '</option>';
    o += '</select>:<select data-mm aria-label="Minute">';
    for (var j = 0; j < 60; j += 5) o += '<option' + (j === mm ? ' selected' : '') + '>' + pad(j) + '</option>';
    if (mm % 5) o += '<option selected>' + pad(mm) + '</option>';
    return o + '</select></span>';
  }
  function timeVal() { var h = pop && pop.querySelector('[data-hh]'), m = pop && pop.querySelector('[data-mm]'); return h && m ? h.value + ':' + m.value : ''; }
  function pick(key) {
    var el = cur.el;
    if (cur.kind === 'datetime-local') { cur.time = timeVal() || cur.time || '09:00'; setVal(el, key + 'T' + cur.time); draw(); return; }
    setVal(el, key); close(); el._sdpProxy.focus();
  }
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || !cur) return;
    if (b.dataset.nav) { cur.m += +b.dataset.nav; if (cur.m < 0) { cur.m = 11; cur.y--; } if (cur.m > 11) { cur.m = 0; cur.y++; } draw(); return; }
    if (b.dataset.day) { pick(b.dataset.day); return; }
    var a = b.dataset.act, t = todayParts();
    if (a === 'today') { cur.y = t.y; cur.m = t.m; pick(ymd(t.y, t.m, t.d)); return; }
    if (a === 'clear') { setVal(cur.el, ''); close(); return; }
    if (a === 'ok') { var p = parse(VALUE.get.call(cur.el)); if (p) setVal(cur.el, ymd(p.y, p.m, p.d) + 'T' + (timeVal() || p.t || '09:00')); close(); }
  }
  function onChange(e) {
    var s = e.target;
    if (s.dataset.sel === 'm') { cur.m = +s.value; draw(); }
    else if (s.dataset.sel === 'y') { cur.y = +s.value; draw(); }
    else if (s.hasAttribute('data-hh') || s.hasAttribute('data-mm')) { cur.time = timeVal(); var p = parse(VALUE.get.call(cur.el)); if (p) setVal(cur.el, ymd(p.y, p.m, p.d) + 'T' + cur.time); }
  }

  function enhance(el) {
    if (el._sdpKind || el.hasAttribute('data-native-date')) return;
    var kind = el.type; if (kind !== 'date' && kind !== 'datetime-local') return;
    addCss();
    var proxy = document.createElement('input');
    proxy.type = 'text'; proxy.readOnly = true; proxy.className = (el.className ? el.className + ' ' : '') + 'sdp-field';
    if (el.getAttribute('style')) proxy.setAttribute('style', el.getAttribute('style'));
    proxy.placeholder = el.getAttribute('data-placeholder') || (kind === 'date' ? 'Select date' : 'Select date & time');
    proxy.setAttribute('aria-haspopup', 'dialog'); proxy.setAttribute('translate', 'no'); proxy.setAttribute('data-no-tr', '');
    if (el.getAttribute('aria-label')) proxy.setAttribute('aria-label', el.getAttribute('aria-label'));
    if (el.id) proxy.id = el.id + '__sdp';
    el._sdpKind = kind; el._sdpProxy = proxy;
    el.type = 'hidden';
    el.parentNode.insertBefore(proxy, el.nextSibling);
    if (el.id) document.querySelectorAll('label[for="' + el.id + '"]').forEach(function (l) { l.htmlFor = proxy.id; });
    el._sdpRender = function () { proxy.value = label(VALUE.get.call(el), kind); proxy.disabled = el.disabled; };
    Object.defineProperty(el, 'value', { configurable: true, get: function () { return VALUE.get.call(el); }, set: function (v) { VALUE.set.call(el, v == null ? '' : v); el._sdpRender(); } });
    proxy.addEventListener('click', function () { open(el); });
    proxy.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(el); }
      else if (e.key === 'Escape') close();
      else if ((e.key === 'Backspace' || e.key === 'Delete') && !el.required) { e.preventDefault(); setVal(el, ''); }
    });
    el._sdpRender();
  }
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type=date],input[type=datetime-local]')) enhance(root);
    root.querySelectorAll('input[type=date],input[type=datetime-local]').forEach(enhance);
  }
  document.addEventListener('mousedown', function (e) { if (pop && !pop.contains(e.target) && (!cur || e.target !== cur.proxy)) close(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) close(); });
  window.addEventListener('resize', place); window.addEventListener('scroll', function (e) { if (pop && !pop.contains(e.target)) place(); }, true);
  function start() {
    scan(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); }); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  window.SDDatePicker = { enhance: enhance, scan: scan, label: label, close: close };
})();
