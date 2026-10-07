/**
 * Tests.gs — ทดสอบระบบ Phase 2–4 ใน Apps Script
 *
 * runSystemTests():
 *  - ส่วน A ตรวจไฟล์จริงแบบอ่านอย่างเดียว
 *  - ส่วน B ทดสอบการเขียนบน "สำเนาชั่วคราว" ของไฟล์ แล้วลบสำเนาทิ้ง — ไฟล์จริงไม่ถูกแก้ไข
 * เรียกจากเมนู "ระบบตารางสอน > ทดสอบระบบ Phase 2–4"
 */

function runSystemTests(sections) {
  var want = function (k) { return !sections || sections.indexOf(k) >= 0; };
  var results = [];
  function t(name, fn) {
    try { var note = fn(); results.push({ ok: true, name: name, note: note || '' }); }
    catch (e) { results.push({ ok: false, name: name, note: e.message }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }
  function expectError(fn, code) {
    try { fn(); } catch (e) { if (!code || e.code === code) return e.message; throw new Error('ได้ข้อผิดพลาด ' + e.code + ' แทน ' + code + ': ' + e.message); }
    throw new Error('ควรถูกปฏิเสธ แต่ระบบยอมให้ทำ');
  }

  // ---------- A: ไฟล์จริง (อ่านอย่างเดียว) ----------
  Db.useSpreadsheet(null);
  var data = Db.loadData();
  var cur = data.terms.filter(function (x) { return x.is_current; });

  t('A1 แผ่นงานครบ 17 แผ่นและคอลัมน์ตรง', function () {
    Object.keys(SCHEMA).forEach(function (k) { Db.all(k); });
    return Object.keys(SCHEMA).length + ' แผ่น';
  });
  t('A2 รหัสไม่ซ้ำทุกแผ่นงาน', function () {
    Object.keys(SCHEMA).forEach(function (k) {
      var key = SCHEMA[k].key, seen = {};
      Db.all(k).forEach(function (r) { assert(!seen[r[key]], SCHEMA[k].sheet + ': รหัสซ้ำ ' + r[key]); seen[r[key]] = 1; });
    });
  });
  t('A3 มีภาคเรียนปัจจุบันหนึ่งภาค และตรงกับค่าตั้งค่า', function () {
    assert(cur.length === 1, 'พบภาคเรียนปัจจุบัน ' + cur.length + ' ภาค');
    assert(Db.get('Settings', 'current_term_id').value === cur[0].term_id, 'ค่า current_term_id ไม่ตรงกับแผ่นภาคเรียน');
    return cur[0].term_id;
  });
  t('A4 ทุกชั้นครบ 30 คาบ (ภาคเรียนปัจจุบัน)', function () {
    var bad = Rules.periodSummary(data, cur[0].term_id).filter(function (s) { return s.diff !== 0; });
    assert(!bad.length, bad.map(function (s) { return s.label; }).join(', '));
  });
  t('A5 ข้อมูลผ่านการตรวจก่อนจัดตาราง', function () {
    var r = Rules.preScheduleChecks(data, cur[0].term_id);
    assert(r.ok, r.errors.map(function (e) { return e.message; }).join(' | '));
    return 'คำเตือน ' + r.warnings.length + ' รายการ';
  });
  t('A6 (Test 6) DARE ไม่อยู่ในภาคเรียนที่ 2', function () {
    var dare = data.subjects.filter(function (s) { return String(s.semester_only) === '1'; }).map(function (s) { return s.subject_id; });
    var sem2 = data.terms.filter(function (x) { return x.semester === 2; }).map(function (x) { return x.term_id; });
    var hit = data.requirements.filter(function (r) { return dare.indexOf(r.subject_id) >= 0 && sem2.indexOf(r.term_id) >= 0 && r.status === 'ใช้งาน'; });
    assert(!hit.length, 'พบ ' + hit.map(function (r) { return r.req_id; }).join(','));
  });
  t('A7 (Test 7–8) ชุมนุม = อังคาร คาบ 6, ลูกเสือ/ยุวกาชาด = พฤหัสบดี คาบ 6', function () {
    var L = data.locks.filter(function (l) { return l.term_id === cur[0].term_id; });
    var club = L.filter(function (l) { return l.group_id === 'G-CLUB'; })[0], scout = L.filter(function (l) { return l.group_id === 'G-SCOUT'; })[0];
    assert(club && club.day === 2 && club.period === 6, 'ชุมนุมไม่อยู่วันอังคารคาบ 6');
    assert(scout && scout.day === 4 && scout.period === 6, 'ลูกเสือไม่อยู่วันพฤหัสบดีคาบ 6');
  });

  t('A8 หน้าเว็บ: ข้อมูลหน้าหลักและข้อมูลเริ่มต้นโหลดได้', function () {
    var b = api({ action: 'public.bootstrap' }), d = api({ action: 'public.dashboard' });
    assert(b.ok && d.ok, (b.error || d.error || {}).message);
    return 'ครู ' + d.data.teachers + ' คน · ชั้น ' + d.data.classes + ' ชั้น';
  });

  var real = Db.spreadsheet();
  // ---------- B: ทดสอบการเขียนบนสำเนา ----------
  if (want('B')) {
  var copyFile = DriveApp.getFileById(real.getId()).makeCopy('[ทดสอบชั่วคราว] ' + real.getName());
  try {
    Db.useSpreadsheet(SpreadsheetApp.openById(copyFile.getId()));
    var ctx = { user: 'ทดสอบระบบ' };
    var term = cur[0].term_id;

    t('B1 (Test 9) เพิ่มครูได้โดยไม่แก้โค้ด', function () {
      var rec = Admin.save(ctx, { table: 'Teachers', record: { name: 'ครูทดสอบ ระบบ', short_name: 'ครูทดสอบ', type: 'ครูประจำ', status: 'ใช้งาน' }, reason: 'ทดสอบ' });
      assert(/^T\d+$/.test(rec.teacher_id), 'รหัสไม่ถูกต้อง'); assert(Db.get('Teachers', rec.teacher_id), 'อ่านกลับไม่ได้');
      return rec.teacher_id;
    });
    t('B2 (Test 10/15) เพิ่มวิชา + โครงสร้าง → ชั้นเกิน 30 และตรวจไม่ผ่าน', function () {
      var s = Admin.save(ctx, { table: 'Subjects', record: { name: 'วิชาทดสอบ', category: 'วิชาเพิ่มเติม', status: 'ใช้งาน' } });
      var tid = Db.all('Teachers').filter(function (x) { return x.name === 'ครูทดสอบ ระบบ'; })[0].teacher_id;
      Admin.save(ctx, { table: 'Requirements', record: { term_id: term, class_id: 'P1', subject_id: s.subject_id, periods: 1, teacher_id: tid, priority: 5, status: 'ใช้งาน' } });
      var p1 = Rules.periodSummary(Db.loadData(), term).filter(function (x) { return x.class_id === 'P1'; })[0];
      assert(p1.total === 31 && p1.status === 'เกิน 1 คาบ', 'ได้ ' + p1.label);
      assert(!Rules.preScheduleChecks(Db.loadData(), term).ok, 'ควรตรวจไม่ผ่าน');
      return p1.label;
    });
    t('B3 (Test 14) ปิดใช้งานโครงสร้าง 1 แถว → แจ้งขาด', function () {
      var r = Db.all('Requirements').filter(function (x) { return x.term_id === term && x.class_id === 'P2' && x.subject_id === 'S21'; })[0];
      Admin.save(ctx, { table: 'Requirements', record: { req_id: r.req_id, status: 'ไม่ใช้งาน' }, reason: 'ทดสอบ' });
      var p2 = Rules.periodSummary(Db.loadData(), term).filter(function (x) { return x.class_id === 'P2'; })[0];
      assert(p2.status === 'ขาด 1 คาบ', 'ได้ ' + p2.label);
      return p2.label;
    });
    t('B4 ข้อมูลผิดถูกปฏิเสธ (ครูไม่มีจริง / จำนวนคาบติดลบ / ค่าสถานะผิด)', function () {
      expectError(function () { Admin.save(ctx, { table: 'Requirements', record: { term_id: term, class_id: 'P1', subject_id: 'S01', periods: 1, teacher_id: 'T99', status: 'ใช้งาน' } }); }, 'VALIDATION');
      expectError(function () { Admin.save(ctx, { table: 'Requirements', record: { term_id: term, class_id: 'P1', subject_id: 'S01', periods: -1, teacher_id: 'T01', status: 'ใช้งาน' } }); }, 'VALIDATION');
      expectError(function () { Admin.save(ctx, { table: 'Teachers', record: { name: 'x', short_name: 'x', type: 'ครูประจำ', status: 'ลาออก' } }); }, 'VALIDATION');
    });
    t('B5 ภาคเรียนที่สิ้นสุดแล้วแก้ไม่ได้ถ้าไม่ระบุเหตุผล', function () {
      var ended = Db.all('Terms').filter(function (x) { return x.status === 'สิ้นสุด'; })[0];
      assert(ended, 'ไม่มีภาคเรียนที่สิ้นสุด');
      expectError(function () { Admin.save(ctx, { table: 'Periods', record: { term_id: ended.term_id, period_no: 9, start_time: '16:00', end_time: '17:00', type: 'คาบเรียน' } }); }, 'TERM_LOCKED');
    });
    t('B6 ห้ามลบครู/วิชา (ใช้การปิดสถานะแทน)', function () {
      expectError(function () { Admin.remove(ctx, { table: 'Teachers', id: 'T01', reason: 'ทดสอบ' }); }, 'FORBIDDEN');
    });
    t('B7 (Test 13) สร้างภาคเรียนถัดไปจากภาคปัจจุบัน — ภาคเดิมไม่เปลี่ยน', function () {
      var before = JSON.stringify(Db.all('Requirements').filter(function (x) { return x.term_id === term; }));
      var cur0 = Db.get('Terms', term);
      var target = cur0.semester === 1 ? { year: cur0.year, semester: 2 } : { year: cur0.year + 1, semester: 1 };
      var res = Admin.createTermFromTerm(ctx, { from_term_id: term, target: target, reason: 'ทดสอบ' });
      var after = JSON.stringify(Db.all('Requirements').filter(function (x) { return x.term_id === term; }));
      assert(before === after, 'ข้อมูลภาคเรียนเดิมเปลี่ยน');
      assert(res.counts.requirements > 0, 'ไม่ได้คัดลอกโครงสร้าง');
      expectError(function () { Admin.createTermFromTerm(ctx, { from_term_id: term, target: target }); }, 'VALIDATION');
      return res.term_id + ': ' + JSON.stringify(res.counts);
    });
    t('B8 ทุกการแก้ไขถูกบันทึกใน Log', function () {
      var n = Db.all('Log').filter(function (l) { return l.user === 'ทดสอบระบบ'; }).length;
      assert(n >= 5, 'พบ Log เพียง ' + n + ' รายการ');
      return n + ' รายการ';
    });
    t('B9 ตั้งภาคเรียนปัจจุบันได้ภาคเดียว', function () {
      var next = Db.all('Terms').filter(function (x) { return x.term_id !== term; })[0];
      Admin.setCurrentTerm(ctx, { term_id: next.term_id });
      var c = Db.all('Terms').filter(function (x) { return x.is_current; });
      assert(c.length === 1 && c[0].term_id === next.term_id, 'ภาคเรียนปัจจุบันไม่ถูกต้อง');
      assert(Db.get('Settings', 'current_term_id').value === next.term_id, 'ค่าตั้งค่าไม่ตรง');
    });
  } finally {
    Db.useSpreadsheet(null);
    copyFile.setTrashed(true);
  }
  }

  // ---------- D: Phase 5 ตาราง Master (บนสำเนาชั่วคราวอีกชุด) ----------
  if (want('D')) {
  var copy2 = DriveApp.getFileById(real.getId()).makeCopy('[ทดสอบชั่วคราว Phase 5] ' + real.getName());
  try {
    Db.useSpreadsheet(SpreadsheetApp.openById(copy2.getId()));
    var ctx5 = { user: 'ทดสอบระบบ' };
    var term5 = cur[0].term_id;
    var draft;
    t('D1 จัดตารางอัตโนมัติได้ ไม่มีความขัดแย้ง และได้ผลเดิมทุกครั้ง (ไม่สุ่ม)', function () {
      draft = Master.generateDraft(ctx5, { term_id: term5 });
      var again = Master.generateDraft(ctx5, { term_id: term5 });
      assert(JSON.stringify(draft.slots) === JSON.stringify(again.slots), 'ผลไม่เหมือนเดิม');
      return draft.slots.length + ' คาบ · ' + draft.notes.join(' · ');
    });
    t('D2 (Test 1) ครูคนเดียวสอน 2 ห้องพร้อมกัน → ไม่บันทึก', function () {
      var bad = JSON.parse(JSON.stringify(draft.slots));
      var a = bad.filter(function (x) { return x.teacher_id === 'T08' && x.class_id === 'P1'; })[0];
      var b = bad.filter(function (x) { return x.teacher_id === 'T08' && x.class_id === 'P2' && !x.co_teacher_id; })[0];
      var other = bad.filter(function (x) { return x.class_id === 'P2' && x.day === a.day && x.period === a.period; })[0];
      other.day = b.day; other.period = b.period; b.day = a.day; b.period = a.period;
      var msg = expectError(function () { Master.saveDraft(ctx5, { term_id: term5, slots: bad }); }, 'CONFLICT');
      assert(msg.indexOf('ป.1 และ ป.2 พร้อมกัน') >= 0 || msg.indexOf('ป.2 และ ป.1 พร้อมกัน') >= 0, msg);
      return msg.split('\n')[2];
    });
    t('D3 (Test 2) ชั้นเดียวมี 2 วิชาพร้อมกัน → ไม่บันทึก', function () {
      var bad = JSON.parse(JSON.stringify(draft.slots));
      var x = bad.filter(function (s) { return s.class_id === 'P3' && s.period === 1; })[0];
      var y = bad.filter(function (s) { return s.class_id === 'P3' && s.period === 2 && s.day === x.day; })[0];
      y.period = 1;
      var msg = expectError(function () { Master.saveDraft(ctx5, { term_id: term5, slots: bad }); }, 'CONFLICT');
      assert(msg.indexOf('มี 2 รายวิชา') >= 0, msg); return 'ปฏิเสธแล้ว';
    });
    t('D4 (Test 3) ครูประกบไม่ว่าง → ไม่บันทึก', function () {
      var bad = JSON.parse(JSON.stringify(draft.slots));
      var co = bad.filter(function (s) { return s.co_teacher_id === 'T10'; })[0];
      var busy = bad.filter(function (s) { return s.teacher_id === 'T10' && s.class_id !== co.class_id && s.day === co.day && s.period !== co.period; })[0]
        || bad.filter(function (s) { return s.teacher_id === 'T10' && s.class_id !== co.class_id; })[0];
      var own = bad.filter(function (s) { return s.class_id === co.class_id && s.day === busy.day && s.period === busy.period; })[0];
      if (own) { own.day = co.day; own.period = co.period; }
      co.day = busy.day; co.period = busy.period;
      var msg = expectError(function () { Master.saveDraft(ctx5, { term_id: term5, slots: bad }); }, 'CONFLICT');
      assert(/ครูธันวา|ธันวา/.test(msg), msg); return 'ปฏิเสธแล้ว';
    });
    t('D5 บันทึกฉบับร่าง → ครูทั่วไปยังไม่เห็น', function () {
      var r = Master.saveDraft(ctx5, { term_id: term5, slots: draft.slots });
      assert(r.version === 1, 'version ' + r.version);
      assert(api({ action: 'public.master', payload: { term_id: term5 } }).data.slots.length === 0, 'ครูเห็นฉบับร่าง');
    });
    t('D6 ตรวจสอบตารางทั้งหมด → สามารถเผยแพร่ได้', function () {
      var r = Master.checkAll(ctx5, { term_id: term5 });
      assert(r.ok, r.errors.map(function (e) { return e.message; }).join(' | ')); return r.message;
    });
    t('D7 เผยแพร่ → ครูเห็นตาราง / ดูย้อนหลังตามวันที่ได้', function () {
      Master.publish(ctx5, { term_id: term5, effective_from: '2026-11-01' });
      var pub = api({ action: 'public.master', payload: { term_id: term5 } }).data;
      assert(pub.slots.length === draft.slots.length && pub.status === 'เผยแพร่แล้ว', 'ไม่พบตารางที่เผยแพร่');
      assert(api({ action: 'public.master', payload: { term_id: term5, date: '2026-10-31' } }).data.slots.length === 0, 'ก่อนวันเริ่มใช้ไม่ควรมีตาราง');
      Master.saveDraft(ctx5, { term_id: term5, slots: draft.slots });
      Master.publish(ctx5, { term_id: term5, effective_from: '2026-12-01' });
      var nov = api({ action: 'public.master', payload: { term_id: term5, date: '2026-11-18' } }).data;
      assert(nov.version === 1, '18 พ.ย. ควรใช้ฉบับ 1 ได้ ' + nov.version);
      var dec = api({ action: 'public.master', payload: { term_id: term5, date: '2026-12-15' } }).data;
      assert(dec.version === 2, '15 ธ.ค. ควรใช้ฉบับ 2 ได้ ' + dec.version);
      return '18 พ.ย. → ฉบับ 1, 15 ธ.ค. → ฉบับ 2';
    });
    t('D8 แก้โครงสร้างหลังเผยแพร่ → สถานะ "ต้องตรวจสอบใหม่"', function () {
      var r = Db.all('Requirements').filter(function (x) { return x.term_id === term5 && x.subject_id === 'S21' && x.class_id === 'P6'; })[0];
      Admin.save(ctx5, { table: 'Requirements', record: { req_id: r.req_id, note: 'ทดสอบ' } });
      assert(Db.get('Terms', term5).schedule_status === 'ต้องตรวจสอบใหม่', Db.get('Terms', term5).schedule_status);
    });
    t('D9 สร้างแผ่นตารางรายชั้น/ตารางครู', function () { var v = Views.render(term5, 'published'); return 'ฉบับ ' + v.version; });
  } finally {
    Db.useSpreadsheet(null);
    copy2.setTrashed(true);
  }
  }

  // ---------- E: Phase 6–7 (บนสำเนาชั่วคราวอีกชุด) ----------
  if (want('E')) {
  var copy3 = DriveApp.getFileById(real.getId()).makeCopy('[ทดสอบชั่วคราว Phase 6–7] ' + real.getName());
  try {
    Db.useSpreadsheet(SpreadsheetApp.openById(copy3.getId()));
    var c6 = { user: 'ทดสอบระบบ' }, tm = cur[0].term_id;
    Db.update('Terms', tm, { start_date: '2026-11-02', end_date: '2027-03-31' }, c6);
    var g6 = Master.generateDraft(c6, { term_id: tm });
    Master.saveDraft(c6, { term_id: tm, slots: g6.slots });
    t('E1 (Phase 6) แก้ฉบับร่างด้วยการสลับคาบที่อนุญาต → บันทึกเป็นฉบับใหม่', function () {
      var dr = Master.get(tm, { which: 'draft' });
      var s0 = dr.slots.filter(function (x) { return x.class_id === 'P1' && x.source !== 'ล็อก'; })[0];
      var opt = Master.swapOptions({ term_id: tm, class_id: 'P1', day: s0.day, period: s0.period }).filter(function (o) { return o.ok; })[0];
      assert(opt, 'ไม่มีช่องที่สลับได้');
      var r = Master.editDraft(c6, { term_id: tm, ops: [{ class_id: 'P1', a: { day: s0.day, period: s0.period }, b: { day: opt.day, period: opt.period } }] });
      return 'ฉบับร่าง ' + r.version;
    });
    t('E2 (Phase 6) สลับที่ทำให้ชนถูกปฏิเสธ / ย้ายกิจกรรมล็อกไม่ได้', function () {
      var dr = Master.get(tm, { which: 'draft' });
      var s0 = dr.slots.filter(function (x) { return x.class_id === 'P1' && x.source !== 'ล็อก'; })[0];
      var bad = Master.swapOptions({ term_id: tm, class_id: 'P1', day: s0.day, period: s0.period }).filter(function (o) { return !o.ok; })[0];
      expectError(function () { Master.editDraft(c6, { term_id: tm, ops: [{ class_id: 'P1', a: { day: s0.day, period: s0.period }, b: { day: bad.day, period: bad.period } }] }); }, 'CONFLICT');
      expectError(function () { Master.editDraft(c6, { term_id: tm, ops: [{ class_id: 'P1', a: { day: 2, period: 6 }, b: { day: 1, period: 1 } }] }); }, 'VALIDATION');
    });
    Master.publish(c6, { term_id: tm, effective_from: '2026-11-02' });
    t('E3 (Phase 7) ตารางรายวัน 18 พ.ย. 2569 = วันพุธ ครบ 6 ชั้น', function () {
      var r = api({ action: 'public.daily', payload: { date: '2026-11-18' } });
      assert(r.ok, r.error && r.error.message);
      assert(r.data.day_name === 'พุธ' && r.data.classes.length === 6 && r.data.check.ok, JSON.stringify(r.data.check));
      var tr = api({ action: 'public.daily', payload: { date: '2026-11-18', teacher_id: 'T02' } }).data.teacher.slots;
      assert(tr.length === 4, 'Teacher วันพุธควรมี 4 คาบ ได้ ' + tr.length);
      return 'Teacher วันพุธ ' + tr.length + ' คาบ';
    });
    t('E4 (Phase 7) ยกเลิกคาบเฉพาะวัน — Master ไม่เปลี่ยน', function () {
      var before = JSON.stringify(Master.get(tm, {}).slots);
      var day = Daily.get('2026-11-18');
      var sl = day.classes[1].slots[0];
      Daily.saveChange(c6, { date: '2026-11-18', slot_id: sl.slot_id, change_type: 'ยกเลิกคาบ', note: 'ทดสอบ', reason: 'ทดสอบ' });
      assert(Daily.get('2026-11-18').classes[1].slots[0].status === 'ยกเลิก', 'ไม่ถูกยกเลิก');
      assert(Daily.get('2026-11-25').classes[1].slots[0].status === 'ปกติ', 'สัปดาห์ถัดไปถูกกระทบ');
      assert(JSON.stringify(Master.get(tm, {}).slots) === before, 'Master ถูกแก้');
    });
    t('E5 (Test 5) ครูอบรมถูกจัดสอนผ่านการเปลี่ยนแปลงรายวัน → ไม่บันทึก', function () {
      Db.insert('Absences', { date: '2026-11-18', teacher_id: 'T01', type: 'อบรม', whole_day: true, status: 'ใช้งาน', created_by: 'ทดสอบ' }, c6);
      var day = Daily.get('2026-11-18');
      assert(day.counts.waiting > 0, 'คาบของครูอบรมควรรอจัดสอนแทน');
      var sl = day.classes[3].slots[0];
      expectError(function () { Daily.saveChange(c6, { date: '2026-11-18', slot_id: sl.slot_id, change_type: 'กิจกรรมพิเศษ', new_teacher_id: 'T01', note: 'ทดสอบ' }); }, 'CONFLICT');
      return 'รอจัดสอนแทน ' + day.counts.waiting + ' คาบ';
    });
    t('E6 วันเสาร์ / วันนอกภาคเรียน → ไม่มีตาราง และบันทึกการเปลี่ยนแปลงไม่ได้', function () {
      assert(Daily.get('2026-11-21').classes.length === 0, 'เสาร์');
      expectError(function () { Daily.saveChange(c6, { date: '2026-11-21', slot_id: 'M00001', change_type: 'ยกเลิกคาบ', note: 'x' }); }, 'VALIDATION');
    });
  } finally {
    Db.useSpreadsheet(null);
    copy3.setTrashed(true);
  }
  }

  // ---------- F: Phase 8–9 ครูไม่อยู่ + สอนแทน (บนสำเนาชั่วคราวอีกชุด) ----------
  if (want('F')) {
  var copy4 = DriveApp.getFileById(real.getId()).makeCopy('[ทดสอบชั่วคราว Phase 8–9] ' + real.getName());
  try {
    Db.useSpreadsheet(SpreadsheetApp.openById(copy4.getId()));
    var c8 = { user: 'ทดสอบระบบ' }, t8 = cur[0].term_id, W = '2026-11-18';
    Db.update('Terms', t8, { start_date: '2026-11-02', end_date: '2027-03-31' }, c8);
    var g8 = Master.generateDraft(c8, { term_id: t8 });
    Master.saveDraft(c8, { term_id: t8, slots: g8.slots });
    Master.publish(c8, { term_id: t8, effective_from: '2026-11-02' });
    var subPick;
    t('F1 (Phase 8) บันทึกครูลา (ทั้งวัน) → คาบของครูรอจัดสอนแทน', function () {
      Absence.save(c8, { date: W, teacher_id: 'T08', type: 'ลาป่วย', whole_day: true, note: 'ไข้', reason: 'ทดสอบ' });
      var p = Substitute.pending(W).pending;
      assert(p.length > 0 && p.every(function (x) { return x.absent_teacher_id === 'T08'; }), JSON.stringify(p));
      return p.length + ' คาบรอจัดสอนแทน';
    });
    t('F2 บันทึกซ้อนช่วงเดิมไม่ได้', function () {
      expectError(function () { Absence.save(c8, { date: W, teacher_id: 'T08', type: 'ลากิจ', whole_day: false, period_from: 1, period_to: 2 }); }, 'CONFLICT');
    });
    t('F3 (Phase 9) เสนอรายชื่อ → Admin ยืนยัน → ตารางรายวันแสดงครูสอนแทน', function () {
      var p = Substitute.pending(W).pending[0];
      var r = Substitute.suggest({ date: W, slot_id: p.slot_id, role: p.role });
      assert(r.candidates.length > 0, 'ไม่มีรายชื่อ');
      subPick = { slot: p, teacher: r.candidates[0].teacher_id };
      Substitute.confirm(c8, { date: W, slot_id: p.slot_id, role: p.role, substitute_teacher_id: subPick.teacher });
      var row = Daily.get(W).classes.filter(function (c) { return c.class_id === p.class_id; })[0].slots.filter(function (s) { return s.slot_id === p.slot_id; })[0];
      assert(row.status === 'สอนแทน' && row.teacher_id === subPick.teacher && row.original_teacher_id === 'T08', JSON.stringify(row));
      return r.candidates[0].label;
    });
    t('F4 เลือกครูที่ไม่ว่างเป็นผู้สอนแทน → ไม่บันทึก', function () {
      var p = Substitute.pending(W).pending[0];
      var busy = Daily.get(W).classes.map(function (c) { return c.slots.filter(function (s) { return s.period === p.period && s.teacher_id && s.teacher_id !== 'T08'; })[0]; }).filter(Boolean)[0].teacher_id;
      return expectError(function () { Substitute.confirm(c8, { date: W, slot_id: p.slot_id, role: p.role, substitute_teacher_id: busy }); }, 'CONFLICT');
    });
    t('F5 ครูที่ถูกจัดสอนแทนอยู่ จะบันทึกว่าไม่อยู่ในคาบนั้นไม่ได้ (ต้องยกเลิกการสอนแทนก่อน)', function () {
      expectError(function () { Absence.save(c8, { date: W, teacher_id: subPick.teacher, type: 'ติดภารกิจ', whole_day: true }); }, 'CONFLICT');
    });
    t('F6 ลาหลายวันข้ามเสาร์-อาทิตย์ → บันทึกเฉพาะวันเรียน', function () {
      var r = Absence.save(c8, { date: '2026-11-20', date_to: '2026-11-24', teacher_id: 'T10', type: 'อบรม', whole_day: true, reason: 'ทดสอบ' });
      assert(r.saved.length === 3 && r.skipped.length === 2, r.saved.length + '/' + r.skipped.length);
      return 'บันทึก 3 วัน ข้าม 2 วัน';
    });
    t('F7 หน้าสาธารณะไม่แสดงหมายเหตุการลา / Admin เห็น', function () {
      var pub = api({ action: 'public.daily', payload: { date: W } }).data;
      assert(pub.absent.length === 1 && pub.absent[0].note === '', 'หมายเหตุรั่ว');
      assert(Daily.get(W, null, true).absent[0].note === 'ไข้', 'Admin ไม่เห็นหมายเหตุ');
    });
    t('F8 รายงานภาระสอนแทน', function () {
      var r = Substitute.report(t8).filter(function (x) { return x.teacher_id === subPick.teacher; })[0];
      assert(r.count === 1, 'นับได้ ' + r.count); return r.name + ' 1 ครั้ง';
    });
    t('F9 ยกเลิกครูไม่อยู่ → การสอนแทนที่เกี่ยวข้องถูกยกเลิก', function () {
      var a = Db.all('Absences').filter(function (x) { return x.teacher_id === 'T08' && x.date === W && x.status === 'ใช้งาน'; })[0];
      var r = Absence.cancel(c8, { absence_id: a.absence_id, reason: 'กลับมาสอน' });
      assert(r.cancelled_substitutions === 1, 'ยกเลิก ' + r.cancelled_substitutions);
      assert(Daily.get(W).counts.substituted === 0 && Daily.get(W).counts.waiting === 0, 'ตารางรายวันยังมีการสอนแทน');
    });
  } finally {
    Db.useSpreadsheet(null);
    copy4.setTrashed(true);
  }
  }

  // ---------- C: การเข้าสู่ระบบ ----------
  if (want('C')) {
  t('C1 token ปลอมถูกปฏิเสธ', function () {
    var r = api({ action: 'admin.save', token: 'fake', payload: { table: 'Teachers', record: {} } });
    assert(!r.ok && r.error.code === 'AUTH', 'ควรถูกปฏิเสธ');
  });
  t('C2 รหัสผ่านผิดถูกปฏิเสธ / ถูกได้ token', function () {
    var u = 'zz-test-' + Math.floor(Math.random() * 1e6);
    Auth.setPassword(u, 'correct-horse-1', 'ทดสอบ');
    try {
      var bad = api({ action: 'auth.login', payload: { username: u, password: 'wrong-pass' } });
      assert(!bad.ok, 'รหัสผิดแต่เข้าได้');
      var good = api({ action: 'auth.login', payload: { username: u, password: 'correct-horse-1' } });
      assert(good.ok && good.data.token, 'รหัสถูกแต่เข้าไม่ได้');
      var who = api({ action: 'admin.whoami', token: good.data.token });
      assert(who.ok, 'token ใช้ไม่ได้');
      api({ action: 'auth.logout', token: good.data.token });
      assert(!api({ action: 'admin.whoami', token: good.data.token }).ok, 'ออกจากระบบแล้วยังใช้ token ได้');
    } finally { Auth.removeUser(u); }
  });
  t('C3 ข้อมูลสาธารณะไม่มีรหัสผ่าน', function () {
    var r = api({ action: 'public.bootstrap' });
    assert(r.ok, r.error && r.error.message);
    var s = JSON.stringify(r.data);
    assert(s.indexOf('hash') < 0 && s.indexOf('salt') < 0 && s.indexOf('ADMIN') < 0, 'พบข้อมูลรหัสผ่าน');
  });
  }

  var pass = results.filter(function (r) { return r.ok; }).length;
  var text = results.map(function (r) { return (r.ok ? '✅ ' : '❌ ') + r.name + (r.note ? ' — ' + r.note : ''); }).join('\n');
  console.log(text);
  return { pass: pass, total: results.length, text: text };
}

function menuRunTests() { runTestsMenu_(['A', 'C'], 'ทดสอบด่วน'); }
function menuRunTestsB() { runTestsMenu_(['B'], 'ทดสอบละเอียด ชุดที่ 1 (ข้อมูลพื้นฐาน)'); }
function menuRunTestsD() { runTestsMenu_(['D'], 'ทดสอบละเอียด ชุดที่ 2 (จัดตาราง)'); }
function menuRunTestsE() { runTestsMenu_(['E'], 'ทดสอบละเอียด ชุดที่ 3 (แก้ตาราง/ตารางรายวัน)'); }
function menuRunTestsF() { runTestsMenu_(['F'], 'ทดสอบละเอียด ชุดที่ 4 (ครูไม่อยู่/สอนแทน)'); }
function runTestsMenu_(sections, title) {
  var r = runSystemTests(sections);
  SpreadsheetApp.getUi().alert(title + ': ผ่าน ' + r.pass + '/' + r.total, r.text, SpreadsheetApp.getUi().ButtonSet.OK);
}
