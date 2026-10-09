/* Sevenday Bike — shared layout + helpers (header, nav, footer, cart, currency, language)
   ໃຊ້ຮ່ວມກັນທຸກໜ້າ: ແກ້ເມນູ / ຂໍ້ມູນຮ້ານ / ອັດຕາແລກປ່ຽນ ບ່ອນນີ້ບ່ອນດຽວ.
   ຄຳແປ ໄທ / English ຢູ່ໃນໄຟລ໌ i18n.js */
(function(){
  const CSS = `.sd-prefs{display:flex;gap:8px;margin-right:6px}
.sd-seg{display:inline-flex;border:1px solid var(--grey-300);border-radius:999px;overflow:hidden;font-size:12px;font-weight:700;flex-shrink:0}
.sd-seg button{padding:6px 10px;white-space:nowrap;line-height:1.2}
.sd-seg button.on{background:var(--black);color:var(--white)}
.sd-pref-m{display:none;align-items:center;font-size:12px;font-weight:800;border:1px solid var(--grey-300);border-radius:999px;padding:6px 10px;white-space:nowrap}
.sd-drawer-prefs{display:grid;gap:12px;padding:16px 20px;border-bottom:1px solid var(--grey-300);background:var(--grey-100)}
.sd-drawer-prefs small{display:block;font-size:12px!important;font-weight:800;color:var(--grey-600);margin-bottom:6px}
.sd-drawer-prefs .sd-seg{display:flex;background:var(--white)}
.sd-drawer-prefs .sd-seg button{flex:1;padding:10px 6px;font-size:14px}
@media(max-width:1180px){.sd-prefs .sd-seg button{padding:6px 8px}}
@media(max-width:900px){.sd-prefs{display:none}.sd-pref-m{display:inline-flex}}
html[lang="th"]{--font:'Archivo','Noto Sans Thai','Noto Sans Lao',system-ui,sans-serif}`;
  const TOP = `<!-- SVG sprite -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-bike" viewBox="0 0 120 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="48" r="19"/><circle cx="96" cy="48" r="19"/><path d="M24 48 46 18h34L96 48M46 18l18 30h-40M64 48 80 18M40 10h14M78 12h10"/></g></symbol>
    <symbol id="i-mtb" viewBox="0 0 120 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="48" r="20"/><circle cx="96" cy="48" r="20"/><path d="M24 48 50 20l14 28H24M50 20h28l18 28M64 48 78 20M46 12h12M74 14l6-4"/><path d="M8 48h0M80 30l8 4" /></g></symbol>
    <symbol id="i-kid" viewBox="0 0 120 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="30" cy="52" r="14"/><circle cx="90" cy="52" r="14"/><path d="M30 52 48 28h26l16 24M48 28l12 24H30M74 28l4-10h8M44 20h10"/></g></symbol>
    <symbol id="i-ebike" viewBox="0 0 120 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="48" r="19"/><circle cx="96" cy="48" r="19"/><path d="M24 48 46 18h34L96 48M46 18l18 30h-40M80 18l4-8"/><rect x="50" y="24" width="20" height="10" rx="2"/><path d="M58 4l-4 8h6l-4 8"/></g></symbol>
    <symbol id="i-helmet" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 44C8 22 24 10 42 10s30 12 30 30v6H14z"/><path d="M28 14l-6 14M44 10v16M58 14l6 14M14 46l-4 8h22"/></g></symbol>
    <symbol id="i-light" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="24" width="34" height="22" rx="6"/><path d="M44 28l12-8v30l-12-8M62 22l10-6M64 35h12M62 48l10 6"/></g></symbol>
    <symbol id="i-lock" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 34V22a18 18 0 0 1 36 0v12"/><rect x="14" y="34" width="52" height="30" rx="4"/><path d="M40 44v10"/></g></symbol>
    <symbol id="i-gear" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="35" r="14"/><circle cx="40" cy="35" r="5"/><path d="M40 9v8M40 53v8M14 35h8M58 35h8M22 17l6 6M52 47l6 6M58 17l-6 6M28 47l-6 6"/></g></symbol>
    <symbol id="i-wrench" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M50 10a14 14 0 0 0-14 18L12 52l6 6 24-24a14 14 0 0 0 18-14l-8 6-8-2-2-8z"/></g></symbol>
    <symbol id="i-used" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 30a26 26 0 0 1 48-8M66 40a26 26 0 0 1-48 8"/><path d="M62 10v12H50M18 60V48h12"/></g></symbol>
    <symbol id="i-flag" viewBox="0 0 80 70"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10v50M14 10l36 10-36 12"/></g></symbol>
  </defs>
</svg>

<div class="announce">ສັ່ງອອນລາຍ ຮັບທີ່ຮ້ານໄດ້ທຸກມື້ · <a href="store.html">ເບິ່ງທີ່ຕັ້ງຮ້ານ</a></div>

<header class="header">
  <div class="wrap header-row">
    <button class="menu-btn" aria-label="ເປີດເມນູ" onclick="toggleDrawer(true)">
      <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <a href="index.html" class="logo" aria-label="Sevenday Bike ໜ້າຫຼັກ">
      <span class="logo-mark">7</span>
      <span class="logo-text">Sevenday Bike<small>ວຽງຈັນ, ລາວ</small></span>
    </a>
    <form class="search" role="search" onsubmit="doSearch(event)">
      <input id="q" type="search" placeholder="ຄົ້ນຫາ ລົດຖີບ, ອາໄຫຼ່, ຍີ່ຫໍ້..." aria-label="ຄົ້ນຫາສິນຄ້າ">
      <button aria-label="ຄົ້ນຫາ"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="9" cy="9" r="7"/><path d="m14 14 5 5"/></svg></button>
    </form>
    <div class="hdr-links">
      <div class="sd-prefs">
        <div class="sd-seg" role="group" aria-label="ພາສາ" translate="no"><button type="button" data-lang="lo">ລາວ</button><button type="button" data-lang="th">ไทย</button><button type="button" data-lang="en">EN</button></div>
        <div class="sd-seg" role="group" aria-label="ສະກຸນເງິນ" translate="no"><button type="button" data-cur="LAK">₭ LAK</button><button type="button" data-cur="THB">฿ THB</button><button type="button" data-cur="USD">$ USD</button></div>
      </div>
      <button type="button" class="sd-pref-m" onclick="toggleDrawer(true)" aria-label="ພາສາ / ສະກຸນເງິນ" translate="no"><span id="sdPrefM">ລາວ · ₭</span></button>
      <a class="hdr-link hide-m" href="service.html"><svg fill="none" stroke="currentColor" stroke-width="1.8"><use href="#i-wrench" /></svg>Workshop</a>
      <a class="hdr-link hide-m" href="store.html"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>ຮ້ານ</a>
      <a class="hdr-link" href="login.html" id="accLink"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/></svg><span id="accLabel">ບັນຊີ</span></a>
      <a class="hdr-link" href="cart.html"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 4h2l2.4 11h11L21 8H7"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>ກະຕ່າ<span class="cart-count" id="cartCount">0</span></a>
    </div>
  </div>
</header>

<nav class="nav" aria-label="ໝວດສິນຄ້າ">
  <ul class="wrap nav-list">
    <li class="nav-item"><a href="catalogue.html?cat=bikes">ລົດຖີບ</a>
      <div class="mega"><div class="wrap mega-inner">
        <div><h4>ຕາມປະເພດ</h4><ul><li><a href="catalogue.html?cat=mtb">ພູເຂົາ</a></li><li><a href="catalogue.html?cat=road">ເສືອໝອບ</a></li><li><a href="catalogue.html?cat=city">ທົ່ວໄປ / City</a></li><li><a href="catalogue.html?cat=ebike">ໄຟຟ້າ</a></li></ul></div>
        <div><h4>ເດັກ & ມືສອງ</h4><ul><li><a href="catalogue.html?cat=kids">ເດັກ</a></li><li><a href="catalogue.html?cat=used">ມືສອງ</a></li></ul></div>
        <div><h4>ທັງໝົດ</h4><ul><li><a href="catalogue.html?cat=bikes">ລົດຖີບທຸກຄັນ</a></li></ul></div>
        <div></div>
        <a class="mega-feature" href="service.html"><b>ຊື້ລົດຖີບ ໄດ້ປັບຕັ້ງໃຫ້ພໍດີກັບຕົວ ຟຣີ</b><span>ເບິ່ງ Workshop</span></a>
      </div></div>
    </li>
    <li class="nav-item"><a href="catalogue.html?cat=parts">ອາໄຫຼ່</a>
      <div class="mega"><div class="wrap mega-inner">
        <div><h4>ລະບົບຂັບ & ເບຣກ</h4><ul><li><a href="catalogue.html?cat=drivetrain">ລະບົບຂັບ & ເກຍ</a></li><li><a href="catalogue.html?cat=brake">ເບຣກ</a></li></ul></div>
        <div><h4>ລໍ້ & ໂຄງ</h4><ul><li><a href="catalogue.html?cat=wheel">ລໍ້ & ຢາງ</a></li><li><a href="catalogue.html?cat=frame">ເຟຣມ & ໂຊັກ</a></li></ul></div>
        <div><h4>ຈຸດສຳຜັດ</h4><ul><li><a href="catalogue.html?cat=cockpit">ແຮນ ເບາະ ບັນໄດ</a></li></ul></div>
        <div><h4>ອື່ນໆ</h4><ul><li><a href="catalogue.html?cat=parts-other">ອາໄຫຼ່ອື່ນໆ</a></li><li><a href="catalogue.html?cat=parts">ອາໄຫຼ່ທັງໝົດ</a></li></ul></div>
        <a class="mega-feature" href="contact.html"><b>ບໍ່ແນ່ໃຈວ່າອາໄຫຼ່ໃສ່ໄດ້ບໍ? ສົ່ງຮູບມາຖາມຊ່າງ</b><span>ຕິດຕໍ່ຮ້ານ</span></a>
      </div></div>
    </li>
    <li class="nav-item"><a href="catalogue.html?cat=accessories">ອຸປະກອນ</a>
      <div class="mega"><div class="wrap mega-inner">
        <div><h4>ຄວາມປອດໄພ</h4><ul><li><a href="catalogue.html?cat=lights">ໄຟ</a></li><li><a href="catalogue.html?cat=locks">ກະແຈລັອກ</a></li></ul></div>
        <div><h4>ບຳລຸງຮັກສາ</h4><ul><li><a href="catalogue.html?cat=tools">ສູບລົມ ເຄື່ອງມື ນ້ຳມັນ</a></li></ul></div>
        <div><h4>ການເດີນທາງ</h4><ul><li><a href="catalogue.html?cat=travel">ກະເປົາ ກະຕິກ ຂາຈັບ</a></li></ul></div>
        <div><h4>ອື່ນໆ</h4><ul><li><a href="catalogue.html?cat=acc-other">ອຸປະກອນອື່ນໆ</a></li><li><a href="catalogue.html?cat=accessories">ອຸປະກອນທັງໝົດ</a></li></ul></div>
        <a class="mega-feature" href="film.html"><b>ຟິມຫຸ້ມສີລົດຖີບ ເລືອກສີໄດ້ເອງ</b><span>ລອງອອກແບບ</span></a>
      </div></div>
    </li>
    <li class="nav-item"><a href="catalogue.html?cat=gear">ເຄື່ອງນຸ່ງ</a>
      <div class="mega"><div class="wrap mega-inner">
        <div><h4>ໝວກ</h4><ul><li><a href="catalogue.html?cat=helmet">ໝວກກັນກະທົບ</a></li></ul></div>
        <div><h4>ເຄື່ອງນຸ່ງ</h4><ul><li><a href="catalogue.html?cat=apparel">ເສື້ອ ຖົງມື ເກີບ</a></li></ul></div>
      </div></div>
    </li>
    <li class="nav-item"><a href="service.html">Workshop</a>
      <div class="mega"><div class="wrap mega-inner">
        <div><h4>ແພັກເກດ Service</h4><ul><li><a href="service.html#basic">Basic</a></li><li><a href="service.html#standard">Standard</a></li><li><a href="service.html#ultimate">Ultimate</a></li></ul></div>
        <div><h4>ບໍລິການອື່ນ</h4><ul><li><a href="service.html">ສ້ອມແປງທົ່ວໄປ</a></li><li><a href="film.html">ຟິມຫຸ້ມສີ</a></li></ul></div>
        <div><h4>ການຈອງ</h4><ul><li><a href="service.html#book">ຈອງຄິວອອນລາຍ</a></li><li><a href="account.html">ເບິ່ງປະຫວັດສ້ອມ</a></li></ul></div>
      </div></div>
    </li>
    <li class="nav-item"><a href="catalogue.html?cat=used">ມືສອງ</a></li>
    <li class="nav-item"><a href="events.html">ກິດຈະກຳ</a>
      <div class="mega"><div class="wrap mega-inner">
        <div><h4>ກິດຈະກຳ</h4><ul><li><a href="events.html">ກິດຈະກຳທັງໝົດ</a></li><li><a href="events.html?type=CYCLING">ປັ່ນລົດຖີບ</a></li><li><a href="events.html?type=RUNNING">ແລ່ນ</a></li><li><a href="events.html?type=COMMUNITY">ກິດຈະກຳຊຸມຊົນ</a></li><li><a href="events.html?type=WORKSHOP">Workshop</a></li></ul></div>
        <div><h4>ການສະໝັກ</h4><ul><li><a href="events.html">ສະໝັກເຂົ້າຮ່ວມ</a></li><li><a href="my-registrations.html">ການສະໝັກຂອງຂ້ອຍ</a></li></ul></div>
        <div><h4>ຜົນການແຂ່ງຂັນ</h4><ul><li><a href="events-results.html">ເບິ່ງຜົນການແຂ່ງຂັນ</a></li></ul></div>
      </div></div>
    </li>
    <li class="nav-item sale push"><a href="catalogue.html?sale=1">Sale</a></li>
  </ul>
</nav>

<div class="collect">
  <div class="wrap">
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-6 9 6v11H3z"/><path d="M9 20v-6h6v6"/></svg>
    <span>ຮັບສິນຄ້າທີ່: <strong>Sevenday Bike ວຽງຈັນ</strong> · ເປີດທຸກມື້ 09:00–18:00</span>
    <a href="store.html">ເບິ່ງແຜນທີ່</a>
  </div>
</div>`;
  const BOTTOM = `<footer class="footer">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a href="index.html" class="logo"><span class="logo-mark">7</span><span class="logo-text">Sevenday Bike</span></a>
        <p>ຮ້ານລົດຖີບ ແລະ Workshop ທີ່ນະຄອນຫຼວງວຽງຈັນ. ເປີດທຸກມື້ 09:00–18:00.</p>
        <div class="social"><a href="#" aria-label="Facebook">f</a><a href="#" aria-label="TikTok">tt</a><a href="#" aria-label="WhatsApp">wa</a></div>
      </div>
      <div><h4>ສິນຄ້າ</h4><ul><li><a href="catalogue.html?cat=bikes">ລົດຖີບ</a></li><li><a href="catalogue.html?cat=parts">ອາໄຫຼ່</a></li><li><a href="catalogue.html?cat=accessories">ອຸປະກອນ</a></li><li><a href="catalogue.html?cat=used">ມືສອງ</a></li><li><a href="catalogue.html?sale=1">Sale</a></li></ul></div>
      <div><h4>Workshop</h4><ul><li><a href="service.html">ແພັກເກດ Service</a></li><li><a href="service.html#book">ຈອງຄິວ</a></li><li><a href="film.html">ຟິມຫຸ້ມສີ</a></li></ul></div>
      <div><h4>ກິດຈະກຳ</h4><ul><li><a href="events.html">ກິດຈະກຳທັງໝົດ</a></li><li><a href="my-registrations.html">ການສະໝັກຂອງຂ້ອຍ</a></li><li><a href="events-results.html">ຜົນການແຂ່ງຂັນ</a></li></ul></div>
      <div><h4>ບັນຊີ</h4><ul><li><a href="login.html">ເຂົ້າສູ່ລະບົບ</a></li><li><a href="account.html">ປະຫວັດການສັ່ງຊື້</a></li><li><a href="account.html">ແຕ້ມສະສົມ</a></li><li><a href="cart.html">ກະຕ່າ</a></li></ul></div>
      <div><h4>ກ່ຽວກັບຮ້ານ</h4><ul><li><a href="about.html">ກ່ຽວກັບເຮົາ</a></li><li><a href="store.html">ທີ່ຕັ້ງຮ້ານ</a></li><li><a href="contact.html">ຕິດຕໍ່</a></li></ul></div>
    </div>
    <div class="foot-bottom">
      <span>© 2026 Sevenday Bike, ວຽງຈັນ</span>
      <div class="pay"><span>BCEL One</span><span>LAK</span><span>THB</span><span>USD</span><span>ເງິນສົດ</span></div>
    </div>
  </div>
</footer>

<!-- Mobile drawer -->
<div class="drawer" id="drawer" aria-hidden="true">
  <div class="drawer-bg" onclick="toggleDrawer(false)"></div>
  <div class="drawer-panel" role="dialog" aria-label="ເມນູ">
    <div class="drawer-top">ເມນູ<button aria-label="ປິດ" onclick="toggleDrawer(false)">✕</button></div>
    <div class="sd-drawer-prefs">
      <div><small>ພາສາ</small><div class="sd-seg" role="group" aria-label="ພາສາ" translate="no"><button type="button" data-lang="lo">ລາວ</button><button type="button" data-lang="th">ไทย</button><button type="button" data-lang="en">EN</button></div></div>
      <div><small>ສະກຸນເງິນ</small><div class="sd-seg" role="group" aria-label="ສະກຸນເງິນ" translate="no"><button type="button" data-cur="LAK">₭ LAK</button><button type="button" data-cur="THB">฿ THB</button><button type="button" data-cur="USD">$ USD</button></div></div>
    </div>
    <details><summary>ລົດຖີບ</summary><ul><li><a href="catalogue.html?cat=mtb">ພູເຂົາ</a></li><li><a href="catalogue.html?cat=road">ເສືອໝອບ</a></li><li><a href="catalogue.html?cat=city">ທົ່ວໄປ / City</a></li><li><a href="catalogue.html?cat=kids">ເດັກ</a></li><li><a href="catalogue.html?cat=ebike">ໄຟຟ້າ</a></li><li><a href="catalogue.html?cat=bikes">ທັງໝົດ</a></li></ul></details>
    <details><summary>ອາໄຫຼ່</summary><ul><li><a href="catalogue.html?cat=drivetrain">ລະບົບຂັບ & ເກຍ</a></li><li><a href="catalogue.html?cat=brake">ເບຣກ</a></li><li><a href="catalogue.html?cat=wheel">ລໍ້ & ຢາງ</a></li><li><a href="catalogue.html?cat=cockpit">ແຮນ ເບາະ ບັນໄດ</a></li><li><a href="catalogue.html?cat=frame">ເຟຣມ & ໂຊັກ</a></li><li><a href="catalogue.html?cat=parts-other">ອາໄຫຼ່ອື່ນໆ</a></li><li><a href="catalogue.html?cat=parts">ທັງໝົດ</a></li></ul></details>
    <details><summary>ອຸປະກອນ</summary><ul><li><a href="catalogue.html?cat=lights">ໄຟ</a></li><li><a href="catalogue.html?cat=locks">ກະແຈລັອກ</a></li><li><a href="catalogue.html?cat=tools">ສູບລົມ ເຄື່ອງມື ນ້ຳມັນ</a></li><li><a href="catalogue.html?cat=travel">ກະເປົາ ກະຕິກ ຂາຈັບ</a></li><li><a href="catalogue.html?cat=acc-other">ອຸປະກອນອື່ນໆ</a></li><li><a href="catalogue.html?cat=accessories">ທັງໝົດ</a></li></ul></details>
    <details><summary>ເຄື່ອງນຸ່ງ</summary><ul><li><a href="catalogue.html?cat=helmet">ໝວກກັນກະທົບ</a></li><li><a href="catalogue.html?cat=apparel">ເສື້ອ ຖົງມື ເກີບ</a></li></ul></details>
    <a class="d-link" href="service.html">Workshop</a>
    <a class="d-link" href="catalogue.html?cat=used">ມືສອງ</a>
    <a class="d-link" href="events.html">ກິດຈະກຳ</a>
    <a class="d-link" href="my-registrations.html">ການສະໝັກຂອງຂ້ອຍ</a>
    <a class="d-link" href="catalogue.html?sale=1">Sale</a>
    <a class="d-link" href="store.html">ທີ່ຕັ້ງຮ້ານ</a>
    <a class="d-link" href="login.html">ບັນຊີ</a>
  </div>
</div>

<div class="toast" id="toast" role="status"></div>`;
  document.head.insertAdjacentHTML('beforeend', '<style id="sd-layout-css">' + CSS + '</style>');
  if (!document.querySelector('header.header')) document.body.insertAdjacentHTML('afterbegin', TOP);
  if (!document.querySelector('footer.footer')) document.body.insertAdjacentHTML('beforeend', BOTTOM);
})();

/* ── ຈຳຂໍ້ມູນສິນຄ້າໄວ້ໃນເບຣົາເຊີ 3 ນາທີ: ປ່ຽນໜ້າແລ້ວບໍ່ຕ້ອງລໍ API ໃໝ່ ── */
(function(){
  const _f = window.fetch.bind(window), TTL = 180000;
  window.fetch = async function(url, opt){
    const u = String(url);
    if (!/action=getProducts/.test(u) || (opt && opt.method === 'POST')) return _f(url, opt);
    const key = 'sd_api_' + u.replace(/^.*\?/, '');
    try { const c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && Date.now() - c.t < TTL) return new Response(c.body, { headers: { 'Content-Type': 'application/json' } }); } catch(_){}
    const r = await _f(url, opt); const body = await r.clone().text();
    try { if (r.ok && JSON.parse(body).ok === true) sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), body })); } catch(_){}
    return r;
  };
})();

const SUBS = {"mtb": ["bikes", "ພູເຂົາ"], "road": ["bikes", "ເສືອໝອບ"], "city": ["bikes", "ທົ່ວໄປ / City"], "kids": ["bikes", "ເດັກ"], "ebike": ["bikes", "ໄຟຟ້າ"], "used": ["used", "ມືສອງ"], "drivetrain": ["parts", "ລະບົບຂັບ & ເກຍ"], "brake": ["parts", "ເບຣກ"], "wheel": ["parts", "ລໍ້ & ຢາງ"], "cockpit": ["parts", "ແຮນ ເບາະ ບັນໄດ"], "frame": ["parts", "ເຟຣມ & ໂຊັກ"], "parts-other": ["parts", "ອາໄຫຼ່ອື່ນໆ"], "lights": ["accessories", "ໄຟ"], "locks": ["accessories", "ກະແຈລັອກ"], "tools": ["accessories", "ສູບລົມ ເຄື່ອງມື ນ້ຳມັນ"], "travel": ["accessories", "ກະເປົາ ກະຕິກ ຂາຈັບ"], "acc-other": ["accessories", "ອຸປະກອນອື່ນໆ"], "helmet": ["gear", "ໝວກກັນກະທົບ"], "apparel": ["gear", "ເສື້ອ ຖົງມື ເກີບ"]};
const GROUPS = {"bikes":"ລົດຖີບ","parts":"ອາໄຫຼ່","accessories":"ອຸປະກອນ","gear":"ເຄື່ອງນຸ່ງ","used":"ມືສອງ"};
const API_URL    = 'https://script.google.com/macros/s/AKfycbyOcu6vlWUnvzRb4GTjEpxz5Amre1KhTYa7wU9PPjVlBd79B8XMzeJER_h-OLrHnxBboA/exec';
const API_SECRET = 'SDdMc3wNjJEevs60n2oMQeGnuI';

/* ── ຂໍ້ມູນຮ້ານ: ແກ້ໄຂບ່ອນນີ້ບ່ອນດຽວ ທຸກໜ້າຈະປ່ຽນຕາມ ── */
const SHOP = {
  name: 'Sevenday Bike',
  phone: '020 9884 4344',
  whatsapp: '8562098844344',
  email: 'Lock.xayasing2021@gmail.com',
  address: 'ບ້ານ ນາໄຊ, ເມືອງ ໄຊເສດຖາ, ນະຄອນຫຼວງວຽງຈັນ',
  mapUrl: 'https://maps.app.goo.gl/NPF26zNDqQ4isNP28',
  hours: 'ເປີດທຸກມື້ 09:00–18:00',
  bank: 'BCEL One · KITTIPHAN XAYASING MR · 013120001235446001',
  bankNo: '013120001235446001'
};

/* POST ໄປ Apps Script: ໃຊ້ text/plain ເພື່ອບໍ່ໃຫ້ຕິດ CORS preflight */
async function apiPost(action, data){
  const r = await fetch(`${API_URL}?action=${action}&secret=${API_SECRET}`, { method:'POST', body: JSON.stringify({ action, secret: API_SECRET, ...data }) });
  const j = await r.json();
  if (j.ok === false) throw new Error(j.error || 'API error');
  return j.data !== undefined ? j.data : j;
}
function fillShop(){ document.querySelectorAll('[data-shop]').forEach(el=>{ const k=el.dataset.shop; if(el.tagName==='A'){ if(k==='phone') el.href='tel:+856'+SHOP.phone.replace(/\s/g,'').replace(/^0/,''); else if(k==='whatsapp') el.href='https://wa.me/'+SHOP.whatsapp; else if(k==='email') el.href='mailto:'+SHOP.email; else if(k==='mapUrl') el.href=SHOP.mapUrl; } if(k!=='mapUrl' && k!=='whatsapp' && !el.children.length) el.textContent=SHOP[k]; }); }
/* ── ອັດຕາແລກປ່ຽນ: ດຶງຈາກ POS (Settings: LAK_TO_THB, USD_TO_THB) ຖ້າດຶງບໍ່ໄດ້ ໃຊ້ຄ່າລຸ່ມນີ້ ── */
let THB_TO_LAK = 698;      // 1 ບາດ = ? ກີບ
let USD_PER_THB = 0.031;   // 1 ບາດ = ? ໂດລາ (≈ 32 ບາດ / ໂດລາ)
const CURRENCIES = ['LAK','THB','USD'];
let currency = 'LAK';
try{ currency = localStorage.getItem('sevenday_cur') || 'LAK'; }catch(_){}
if (!CURRENCIES.includes(currency)) currency = 'LAK';
try{ const r = JSON.parse(localStorage.getItem('sd_rates') || 'null'); if (r){ if (r.lak > 0) THB_TO_LAK = r.lak; if (r.usd > 0) USD_PER_THB = r.usd; } }catch(_){}
(async function loadRates(){
  try{
    const c = JSON.parse(localStorage.getItem('sd_rates') || 'null');
    if (c && Date.now() - c.t < 6 * 3600e3) return;
    const j = await (await fetch(`${API_URL}?action=getSettings&secret=${API_SECRET}`)).json();
    const d = (j && j.data) || j || {}; const lak = +d.lak_to_thb, usd = +d.usd_to_thb;
    if (!(lak > 0)) return;
    const changed = lak !== THB_TO_LAK || (usd > 0 && usd !== USD_PER_THB);
    THB_TO_LAK = lak; if (usd > 0) USD_PER_THB = usd;
    try{ localStorage.setItem('sd_rates', JSON.stringify({ lak, usd: USD_PER_THB, t: Date.now() })); }catch(_){}
    if (changed) document.dispatchEvent(new Event('currencychange'));
  }catch(_){}
})();
function curSymbol(c){ c = c || currency; return c === 'THB' ? '฿' : c === 'USD' ? '$' : '₭'; }
/* ແປງ ບາດ ↔ ສະກຸນທີ່ເລືອກ (ຕົວເລກ) */
function fromTHB(thb, c){ c = c || currency; return c === 'THB' ? thb : c === 'USD' ? thb * USD_PER_THB : thb * THB_TO_LAK; }
function toTHB(v, c){ if (v === '' || v == null) return null; c = c || currency; return c === 'THB' ? +v : c === 'USD' ? +v / USD_PER_THB : +v / THB_TO_LAK; }

function getCart(){ try{ return JSON.parse(localStorage.getItem('sevenday_cart')) || []; }catch(_){ return []; } }
function setCart(c){ try{ localStorage.setItem('sevenday_cart', JSON.stringify(c)); }catch(_){} updateCartCount(); }
function updateCartCount(){ const el=document.getElementById('cartCount'); if(el) el.textContent=getCart().reduce((s,i)=>s+(i.qty||1),0); }
function fmtIn(thb, c){
  if (thb == null || thb === '' || isNaN(thb)) return '';
  c = c || currency;
  if (c === 'USD') return '$' + (thb * USD_PER_THB).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c === 'THB') return '฿' + Math.round(thb).toLocaleString('en-US');
  return '₭' + Math.round(thb * THB_TO_LAK).toLocaleString('en-US');
}
function fmt(thb){ return fmtIn(thb, currency); }
function setCurrency(c){
  if (!CURRENCIES.includes(c)) return;
  currency = c; try{ localStorage.setItem('sevenday_cur', c); }catch(_){}
  document.querySelectorAll('[data-cur]').forEach(x => x.classList.toggle('on', x.dataset.cur === c));
  sdPrefLabel();
  document.dispatchEvent(new Event('currencychange'));
}
let _toastT;
function toast(html){ const t=document.getElementById('toast'); if(!t) return; t.innerHTML=html; t.classList.add('show'); clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('show'),3000); }
function doSearch(e){ e.preventDefault(); const q=document.getElementById('q').value.trim(); if(q) location.href='catalogue.html?q='+encodeURIComponent(q); }
function toggleDrawer(open){ const d=document.getElementById('drawer'); d.classList.toggle('open',open); d.setAttribute('aria-hidden',!open); document.body.style.overflow=open?'hidden':''; }
function iconFor(cat){
  const c=(cat||'').toLowerCase();
  if(/mtb|mountain|ພູ|ภูเขา/.test(c)) return '#i-mtb';
  if(/kid|ເດັກ|เด็ก/.test(c)) return '#i-kid';
  if(/helmet|ໝວກ|หมวก/.test(c)) return '#i-helmet';
  if(/light|ໄຟ|ไฟ/.test(c)) return '#i-light';
  if(/lock|ລັອກ|ล็อค/.test(c)) return '#i-lock';
  if(/ຈັກ|จักร|bike/.test(c)) return '#i-bike';
  return '#i-gear';
}
function mapP(p){
  const name=String(p.name||'');
  return { sku:String(p.sku||''), name, brand:name.split(' ')[0], category:p.category||p.type||'',
    type:p.type||'', price:Number(p.price||p.price_thb||0), was:Number(p.was_price||0)||null,
    stock:Number(p.stock||0), unit:p.unit||'', group:p.group||'', sub:p.sub||'', image:p.image||p.imageUrl||p.image_url||'', sizes:p.sizes||[] };
}
function isService(p){ if(p.group==='service') return true; const t=(p.category+' '+p.type).toLowerCase(); return /service|ບໍລິການ|บริการ|ຄ່າ|ค่า/.test(t); }
function apiList(json){ const l=json.products||json.data?.products||json.data?.data||json.data||[]; return Array.isArray(l)?l:[]; }
function card(p){
  const out=p.stock<=0, low=!out&&p.stock<=2;
  const off=p.was&&p.was>p.price?Math.round((1-p.price/p.was)*100):0;
  const badges=[off?`<span class="badge b-off">-${off}%</span>`:'',low?`<span class="badge b-low">ເຫຼືອ ${p.stock}</span>`:'',out?`<span class="badge b-out">ໝົດ</span>`:''].join('');
  const img=p.image?`<img src="${p.image}" alt="${p.name}" loading="lazy">`:`<svg viewBox="0 0 120 70" aria-hidden="true"><use href="${iconFor(p.category+' '+p.name)}"/></svg>`;
  const href=`product.html?sku=${encodeURIComponent(p.sku)}`;
  const sizes=(p.sizes||[]).length?`<div class="sizes">${p.sizes.map(s=>`<span>${s}</span>`).join('')}</div>`:'';
  return `<article class="card ${off?'on-sale':''}"><a class="card-img" href="${href}"><div class="badges">${badges}</div>${img}</a>
    <span class="card-brand">${p.brand||''}</span><a class="card-name" href="${href}">${p.name}</a>
    <div class="price"><span class="now">${fmt(p.price)}</span>${off?`<span class="was">${fmt(p.was)}</span>`:''}</div>${sizes}
    <button class="add-btn" ${out?'disabled':''} onclick="quickAdd('${encodeURIComponent(p.sku)}')">${out?'ສິນຄ້າໝົດ':'ໃສ່ກະຕ່າ'}</button></article>`;
}
window._catalog = [];
function addItem(p, qty){
  const cart=getCart(); const row=cart.find(i=>i.sku===p.sku);
  if(row) row.qty+=qty||1; else cart.push({sku:p.sku,name:p.name,price:p.price,qty:qty||1,image:p.image||'',category:p.category||''});
  setCart(cart); toast(`ເພີ່ມ ${p.name} ໃສ່ກະຕ່າແລ້ວ <a href="cart.html">ເບິ່ງກະຕ່າ</a>`);
}
function quickAdd(enc){ const sku=decodeURIComponent(enc); const p=window._catalog.find(x=>x.sku===sku); if(p) addItem(p,1); }

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-cur]').forEach(b=>{
    b.classList.toggle('on',b.dataset.cur===currency);
    b.onclick=()=>setCurrency(b.dataset.cur);
  });
  document.querySelectorAll('[data-lang]').forEach(b=>{
    b.classList.toggle('on',b.dataset.lang===SD_LANG);
    b.onclick=()=>setLang(b.dataset.lang);
  });
  sdPrefLabel();
  try{ const u=JSON.parse(sessionStorage.getItem('sd_user')||'null'); if(u){ document.getElementById('accLink').href='account.html'; document.getElementById('accLabel').textContent=(u.name||'ບັນຊີ').split(' ')[0]; } }catch(_){}
  const q=new URLSearchParams(location.search).get('q'); if(q&&document.getElementById('q')) document.getElementById('q').value=q;
  updateCartCount(); fillShop();
});

/* ── ພາສາ: ລາວ (ຕົ້ນສະບັບ) / ไทย / English ──
   ໜ້າເວັບຂຽນເປັນພາສາລາວ. ເມື່ອເລືອກພາສາອື່ນ ຈະແປຂໍ້ຄວາມທີ່ພົບໃນ SD_DICT (i18n.js) ອັດຕະໂນມັດ
   ລວມທັງຂໍ້ຄວາມທີ່ໜ້າເວັບສ້າງຂຶ້ນພາຍຫຼັງ. ຂໍ້ຄວາມທີ່ບໍ່ມີໃນ i18n.js ຈະສະແດງເປັນລາວຄືເກົ່າ. */
const SD_LANGS = ['lo', 'th', 'en'];
let SD_LANG = 'lo';
try { SD_LANG = localStorage.getItem('sevenday_lang') || 'lo'; } catch (_) {}
{ const q = new URLSearchParams(location.search).get('lang'); if (q && SD_LANGS.includes(q)) { SD_LANG = q; try { localStorage.setItem('sevenday_lang', q); } catch (_) {} } }
if (!SD_LANGS.includes(SD_LANG)) SD_LANG = 'lo';

const sdI18n = (function () {
  const LAO = /[຀-໿]/;
  const norm = s => String(s).replace(/ໍາ/g, 'ຳ').replace(/\s+/g, ' ').trim();
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const tNodes = new WeakMap();   // text node → { src, out }
  const aNodes = new WeakMap();   // element → { attr: { src, out } }
  let maps = {}, pats = {}, frags = {};

  function prepare() {
    const D = window.SD_DICT || {};
    ['th', 'en'].forEach(l => {
      const m = new Map(), p = [];
      Object.keys(D).forEach(k => {
        const v = D[k] && D[k][l]; if (!v) return;
        const nk = norm(k);
        if (nk.includes('{0}')) {
          const parts = nk.split('{0}').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          p.push({ re: new RegExp('^' + parts.join('(.+?)') + '$'), out: v, n: nk.length });
        } else m.set(nk, v);
      });
      p.sort((a, b) => b.n - a.n);
      maps[l] = m; pats[l] = p;
      frags[l] = Object.entries((window.SD_FRAGS || {})[l] || {}).sort((a, b) => b[0].length - a[0].length);
    });
  }

  function tr(s, lang) {
    lang = lang || SD_LANG;
    if (lang === 'lo' || s == null) return s;
    const str = String(s);
    if (!LAO.test(str)) return str;
    if (!maps[lang]) prepare();
    const lead = str.match(/^\s*/)[0], tail = str.match(/\s*$/)[0];
    const k = norm(str);
    let v = maps[lang].get(k);
    if (v === undefined) {
      for (const p of pats[lang]) {
        const m = k.match(p.re);
        if (m) { let i = 1; v = p.out.replace(/\{0\}/g, () => tr(m[i++], lang)); break; }
      }
    }
    if (v === undefined) {
      // ແປສ່ວນຍ່ອຍ (ເດືອນ, ຫົວໜ່ວຍ...) ຖ້າບໍ່ພົບທັງປະໂຫຍກ
      let out = k, hit = false;
      for (const [a, b] of frags[lang]) if (out.includes(a)) { out = out.split(a).join(b); hit = true; }
      if (!hit) return str;
      v = out;
    }
    return lead + v + tail;
  }

  function doText(n) {
    const rec = tNodes.get(n);
    const cur = n.nodeValue;
    let src;
    if (rec && cur === rec.out) src = rec.src;        // ເຮົາແປໄວ້ແລ້ວ
    else src = cur;                                    // ໃໝ່ ຫຼື ໜ້າເວັບປ່ຽນຂໍ້ຄວາມ
    if (!rec && !LAO.test(src)) return;
    const out = SD_LANG === 'lo' ? src : tr(src);
    tNodes.set(n, { src, out });
    if (out !== cur) n.nodeValue = out;
  }
  function doAttrs(el) {
    let rec = aNodes.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a), r = rec && rec[a];
      const src = r && cur === r.out ? r.src : cur;
      if (!r && !LAO.test(src)) continue;
      const out = SD_LANG === 'lo' ? src : tr(src);
      if (!rec) { rec = {}; aNodes.set(el, rec); }
      rec[a] = { src, out };
      if (out !== cur) el.setAttribute(a, out);
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      const r = rec && rec.value, cur = el.value, src = r && cur === r.out ? r.src : cur;
      if (r || LAO.test(src)) { const out = SD_LANG === 'lo' ? src : tr(src); if (!rec) { rec = {}; aNodes.set(el, rec); } rec.value = { src, out }; if (out !== cur) el.value = out; }
    }
  }
  function skip(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (SKIP[e.tagName] || e.isContentEditable || e.getAttribute('translate') === 'no' || e.classList.contains('notranslate')) return true;
    }
    return false;
  }
  function noTr(el) { return !!(el.closest && el.closest('[translate="no"],.notranslate')); }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (root.parentElement && !skip(root.parentElement)) doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && skip(root)) { if (root.tagName === 'TEXTAREA' && !noTr(root)) doAttrs(root); return; }
    if (root.nodeType === 1) doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
        if (n.getAttribute('translate') === 'no' || n.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT;
        if (SKIP[n.tagName]) { if (n.tagName === 'TEXTAREA') doAttrs(n); return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  let busy = false;
  const mo = new MutationObserver(list => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') { if (m.target.parentElement && !skip(m.target.parentElement)) doText(m.target); }
        else if (m.type === 'attributes' && !noTr(m.target)) doAttrs(m.target);
      }
    } finally { busy = false; mo.takeRecords(); }
  });

  function apply() {
    busy = true;
    try { walk(document.head && document.head.querySelector('title')); walk(document.body); }
    finally { busy = false; mo.takeRecords(); }
  }
  function start() {
    document.documentElement.lang = SD_LANG;
    if (SD_LANG === 'th' && !document.getElementById('sd-font-th')) {
      document.head.insertAdjacentHTML('beforeend', '<link id="sd-font-th" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap">');
    }
    if (SD_LANG !== 'lo' || start.ran) apply();
    if (!start.ran) {
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value') });
      start.ran = true;
    }
  }
  return { tr, start, apply, prepare };
})();

/* ຂໍ້ຄວາມໃນ alert / confirm / prompt ກໍແປນຳ */
['alert', 'confirm', 'prompt'].forEach(fn => {
  const orig = window[fn];
  if (typeof orig === 'function') window[fn] = function (msg, ...rest) { return orig.call(window, sdI18n.tr(msg), ...rest); };
});
function sdT(s) { return sdI18n.tr(s); }
function sdPrefLabel() {
  const el = document.getElementById('sdPrefM');
  if (el) el.textContent = ({ lo: 'ລາວ', th: 'ไทย', en: 'EN' })[SD_LANG] + ' · ' + curSymbol();
}
function setLang(l) {
  if (!SD_LANGS.includes(l) || l === SD_LANG) return;
  SD_LANG = l;
  try { localStorage.setItem('sevenday_lang', l); } catch (_) {}
  document.querySelectorAll('[data-lang]').forEach(x => x.classList.toggle('on', x.dataset.lang === l));
  sdPrefLabel();
  sdI18n.start();
  document.dispatchEvent(new Event('langchange'));
}
sdI18n.start();

