/* Sevenday — ຄ່າເລີ່ມຕົ້ນ ລາຄາ Service / ຟິມ (ໃຊ້ເມື່ອຍັງບໍ່ໄດ້ຕັ້ງໃນ Admin → ຕັ້ງຄ່າໜ້າເວັບ) */
(function(){
const L3 = (lo, th, en) => ({ lo, th, en });
var DEF_SERVICES = {
  packages: [
    { name: 'Basic', price_lak: 80000, popular: false, time: L3('ໃຊ້ເວລາ ~1 ຊົ່ວໂມງ', 'ใช้เวลา ~1 ชั่วโมง', 'Takes ~1 hour'), items: [
      L3('ກວດ ແລະ ປັບເບຣກ', 'ตรวจและปรับเบรก', 'Brake check & adjustment'), L3('ປັບເກຍໃຫ້ປ່ຽນລື່ນ', 'ปรับเกียร์ให้เปลี่ยนลื่น', 'Gear tuning for smooth shifting'),
      L3('ເຕີມລົມຢາງ ຕາມມາດຕະຖານ', 'เติมลมยางตามมาตรฐาน', 'Tires inflated to spec'), L3('ຫຼໍ່ລື່ນໂສ້', 'หล่อลื่นโซ่', 'Chain lube'),
      L3('ກວດຄວາມແໜ້ນນັອດທັງຄັນ', 'ตรวจความแน่นน็อตทั้งคัน', 'Bolt torque check on the whole bike')] },
    { name: 'Standard', price_lak: 200000, popular: true, time: L3('ໃຊ້ເວລາ ~1 ມື້', 'ใช้เวลา ~1 วัน', 'Takes ~1 day'), items: [
      L3('ທຸກຢ່າງໃນ Basic', 'ทุกอย่างใน Basic', 'Everything in Basic'), L3('ລ້າງລະບົບຂັບ (ໂສ້ ເຟືອງ ຈານ)', 'ล้างระบบขับ (โซ่ เฟือง จาน)', 'Drivetrain clean (chain, cassette, chainrings)'),
      L3('ຕັ້ງສູນລໍ້ (ດັດລໍ້)', 'ตั้งศูนย์ล้อ (ดัดล้อ)', 'Wheel truing'), L3('ກວດແບຣິ່ງ ດຸມ ຄໍ ກະໂຫຼກ', 'ตรวจแบริ่ง ดุม คอ กะโหลก', 'Bearing check: hubs, headset, bottom bracket'),
      L3('ລ້າງລົດຖີບທັງຄັນ', 'ล้างจักรยานทั้งคัน', 'Full bike wash')] },
    { name: 'Ultimate', price_lak: 500000, popular: false, time: L3('ໃຊ້ເວລາ 2–3 ມື້', 'ใช้เวลา 2–3 วัน', 'Takes 2–3 days'), items: [
      L3('ທຸກຢ່າງໃນ Standard', 'ทุกอย่างใน Standard', 'Everything in Standard'), L3('ຖອດລ້າງທັງຄັນ ທຸກຊິ້ນສ່ວນ', 'ถอดล้างทั้งคัน ทุกชิ้นส่วน', 'Full strip-down and clean of every part'),
      L3('ອັດຈາລະບີແບຣິ່ງທັງໝົດ', 'อัดจาระบีแบริ่งทั้งหมด', 'Regrease all bearings'), L3('ປ່ຽນສາຍເບຣກ ສາຍເກຍ', 'เปลี่ยนสายเบรก สายเกียร์', 'New brake and gear cables'),
      L3('ບຳລຸງໂຊັກ (ຄ່າອາໄຫຼ່ແຍກ)', 'บำรุงโช้ค (ค่าอะไหล่แยก)', 'Fork service (parts extra)')] },
  ],
  repairs: [
    { name: L3('ສ້ອມທົ່ວໄປ', 'ซ่อมทั่วไป', 'General repairs'), desc: L3('ປະເຊື້ອຢາງ, ປ່ຽນຢາງໃນ', 'ปะยาง, เปลี่ยนยางใน', 'Puncture repair, new inner tube'), price_lak: 30000, note: L3('', '', ''), link: '' },
    { name: L3('ລະບົບເບຣກ', 'ระบบเบรก', 'Brakes'), desc: L3('ປ່ຽນຜ້າເບຣກ, ໄລ່ລົມເບຣກນ້ຳມັນ', 'เปลี่ยนผ้าเบรก, ไล่ลมเบรกน้ำมัน', 'Brake pads, hydraulic brake bleed'), price_lak: 60000, note: L3('', '', ''), link: '' },
    { name: L3('ລະບົບຂັບ', 'ระบบขับ', 'Drivetrain'), desc: L3('ປ່ຽນໂສ້ ເຟືອງ ຕີນຜີ', 'เปลี่ยนโซ่ เฟือง ตีนผี', 'Chain, cassette, derailleur replacement'), price_lak: 80000, note: L3('', '', ''), link: '' },
    { name: L3('ລໍ້', 'ล้อ', 'Wheels'), desc: L3('ດັດລໍ້, ປ່ຽນຊີ່ລວດ', 'ดัดล้อ, เปลี่ยนซี่ลวด', 'Wheel truing, spoke replacement'), price_lak: 50000, note: L3('', '', ''), link: '' },
    { name: L3('ຕິດຕັ້ງອຸປະກອນ', 'ติดตั้งอุปกรณ์', 'Accessory fitting'), desc: L3('ໄຟ, ຂາຕັ້ງ, ໄມລ໌, ແຮັກ', 'ไฟ, ขาตั้ง, ไมล์, แร็ก', 'Lights, kickstands, computers, racks'), price_lak: 50000, note: L3('', '', ''), link: '' },
    { name: L3('Bike Fit', 'Bike Fit', 'Bike Fit'), desc: L3('ປັບເບາະ ແຮນ ໃຫ້ພໍດີຕົວ', 'ปรับเบาะ แฮนด์ ให้พอดีตัว', 'Saddle & bar fit adjustment'), price_lak: '', note: L3('ຟຣີ ເມື່ອຊື້ລົດຖີບ', 'ฟรี เมื่อซื้อจักรยาน', 'Free with a bike purchase'), link: '' },
    { name: L3('ຟິມຫຸ້ມສີ', 'ฟิล์มหุ้มสี', 'Bike wrap'), desc: L3('ປ່ຽນສີລົດຖີບ 80+ ສີ', 'เปลี่ยนสีจักรยาน 80+ สี', 'Recolor your bike — 80+ colors'), price_lak: '', note: L3('ອອກແບບເອງ', 'ออกแบบเอง', 'Design your own'), link: 'film.html' },
    { name: L3('ບໍ່ຮູ້ວ່າເປັນຫຍັງ?', 'ไม่รู้ว่าเป็นอะไร?', 'Not sure what’s wrong?'), desc: L3('ເອົາມາໃຫ້ຊ່າງກວດ', 'นำมาให้ช่างตรวจ', 'Bring it in for a check'), price_lak: '', note: L3('ກວດຟຣີ', 'ตรวจฟรี', 'Free check'), link: '' },
  ],
  film: [
    { name: 'Accent Wrap', price_lak: 300000, desc: L3('ບາງສ່ວນ ເຊັ່ນ ທໍ່ເທິງ ຫຼື ໂຊັກ', 'บางส่วน เช่น ท่อบน หรือโช้ค', 'Partial, e.g. top tube or fork') },
    { name: 'Full Frame Wrap', price_lak: 800000, desc: L3('ທັງເຟຣມ + ໂຊັກ', 'ทั้งเฟรม + โช้ค', 'Full frame + fork') },
    { name: 'Premium Wrap', price_lak: 1500000, desc: L3('ທັງຄັນ ລວມຂອບລໍ້ ຟິມພິເສດ', 'ทั้งคัน รวมขอบล้อ ฟิล์มพิเศษ', 'Whole bike incl. rims, premium film') },
  ],
};
window.DEF_SERVICES = DEF_SERVICES;
})();
