/* Sevenday Bike — ຄຳແປສຳລັບໜ້າ Events (ໂຫຼດຫຼັງ i18n.js, ກ່ອນ layout.js)
   ຊື່ລຸ້ນ / ລາຍລະອຽດ / ຊື່ງານ ທີ່ແອັດມິນພິມເປັນລາວ → ໄທ / English
   • PHRASES: ແປທັງປະໂຫຍກ (ຕ້ອງພິມຕົງກັນທຸກຕົວ)
   • PARTS:   ແປສ່ວນຍ່ອຍພາຍໃນຂໍ້ຄວາມ ເຊັ່ນ "ທົ່ວໄປຊາຍ - ເສືອໝອບ" → "Open Men - Road bike"
              (ໃຊ້ສະເພາະໜ້າ Events ບໍ່ກະທົບໜ້າສິນຄ້າ)
   ເພີ່ມຄຳໃໝ່: "ຂໍ້ຄວາມລາວ": ["ภาษาไทย", "English"], */
(function () {
  var PHRASES = {
    "ມີນ້ຳດື່ມ, ອາຫານ, ເສື້ອ, ຮູບກິດຈະກຳ": ["มีน้ำดื่ม อาหาร เสื้อ และรูปกิจกรรม", "Includes drinking water, food, jersey and event photos"]
  };
  var PARTS = {
    // ລາຍລະອຽດລຸ້ນ
    "ມີນ້ຳດື່ມ, ອາຫານ, ເສື້ອ, ຮູບກິດຈະກຳ": ["มีน้ำดื่ม อาหาร เสื้อ และรูปกิจกรรม", "Includes drinking water, food, jersey and event photos"],
    "ບໍ່ຈຳກັດປະເພດລົດ": ["ไม่จำกัดประเภทรถ", "Any bike type"],
    // ຊື່ລຸ້ນ
    "ເຍົາວະຊົນຊາຍ": ["เยาวชนชาย", "Youth Men"],
    "ເຍົາວະຊົນຍິງ": ["เยาวชนหญิง", "Youth Women"],
    "ທົ່ວໄປຊາຍ": ["ทั่วไปชาย", "Open Men"],
    "ທົ່ວໄປຍິງ": ["ทั่วไปหญิง", "Open Women"],
    "ອາຍຸ40+ຊາຍ": ["อายุ 40+ ชาย", "Men 40+"],
    "ອາຍຸ 40+ ຊາຍ": ["อายุ 40+ ชาย", "Men 40+"],
    "ອາຍຸ40+ຍິງ": ["อายุ 40+ หญิง", "Women 40+"],
    "ອາຍຸ50+ຊາຍ": ["อายุ 50+ ชาย", "Men 50+"],
    "ເສືອໝອບ": ["เสือหมอบ", "Road bike"],
    "ເສືອພູເຂົາ": ["เสือภูเขา", "Mountain bike"],
    "ລົດພັບ": ["จักรยานพับ", "Folding bike"],
    // ຊື່ງານ / ສະຖານທີ່
    "ການແຂ່ງຂັນຊິງຂັນປະທານ": ["การแข่งขันชิงถ้วยประธาน", "President's Cup Race"],
    "ສະຫະພັນລົດຖີບແຫ່ງຊາດ": ["สหพันธ์จักรยานแห่งชาติ", "National Cycling Federation"],
    "ສະຫະພັນລົດແຫ່ງຊາດ": ["สหพันธ์จักรยานแห่งชาติ", "National Cycling Federation"],
    "ບຶງທາດຫຼວງ": ["บึงธาตุหลวง", "That Luang Marsh"]
  };
  var D = window.SD_DICT || (window.SD_DICT = {}), F = window.SD_FRAGS || (window.SD_FRAGS = {});
  F.th = F.th || {}; F.en = F.en || {};
  Object.keys(PHRASES).forEach(function (k) { D[k] = { th: PHRASES[k][0], en: PHRASES[k][1] }; });
  // ຄຳປະສົມ ເຊັ່ນ "ທົ່ວໄປຍິງ" ອາດພິມເປັນ "ທົ່ວໄປ ຍິງ" → ເພີ່ມແບບມີຍະຫວ່າງໃຫ້ອັດຕະໂນມັດ
  var SPLIT = /^(ເຍົາວະຊົນ|ທົ່ວໄປ|ເສືອ)(.+)$/;
  Object.keys(PARTS).forEach(function (k) {
    var keys = [k], m = k.match(SPLIT); if (m) keys.push(m[1] + ' ' + m[2]);
    keys.forEach(function (x) { F.th[x] = PARTS[k][0]; F.en[x] = PARTS[k][1]; });
  });
})();
