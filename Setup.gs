/**
 * Setup.gs — สร้างแผ่นงาน นำเข้าข้อมูลเริ่มต้น และเมนูใน Google Sheets (Phase 3)
 *
 * วิธีใช้: เปิด Google Sheets → เมนู "ระบบตารางสอน" → "1) ตั้งค่าครั้งแรก"
 * ฟังก์ชันนี้ปลอดภัยที่จะรันซ้ำ: ไม่ลบและไม่เขียนทับข้อมูลที่มีอยู่
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบตารางสอน')
    .addItem('1) ตั้งค่าครั้งแรก (สร้างแผ่นงาน + ข้อมูลเริ่มต้น)', 'firstTimeSetup')
    .addItem('2) เพิ่ม/เปลี่ยนรหัสผ่าน Admin', 'menuSetAdminPassword')
    .addItem('ดูรายชื่อ Admin', 'menuListAdmins')
    .addSeparator()
    .addItem('ตรวจข้อมูลก่อนจัดตาราง (ภาคเรียนปัจจุบัน)', 'menuPreChecks')
    .addSubMenu(SpreadsheetApp.getUi().createMenu('ทดสอบระบบ')
      .addItem('ทดสอบด่วน (ประมาณ 10 วินาที)', 'menuRunTests')
      .addItem('ทดสอบละเอียด ชุดที่ 1: ข้อมูลพื้นฐาน', 'menuRunTestsB')
      .addItem('ทดสอบละเอียด ชุดที่ 2: จัดตาราง', 'menuRunTestsD')
      .addItem('ทดสอบละเอียด ชุดที่ 3: แก้ตาราง/ตารางรายวัน', 'menuRunTestsE')
      .addItem('ทดสอบละเอียด ชุดที่ 4: ครูไม่อยู่/สอนแทน', 'menuRunTestsF'))
    .addSeparator()
    .addItem('จัดตารางอัตโนมัติ (บันทึกเป็นฉบับร่าง)', 'menuGenerateSchedule')
    .addItem('ตรวจสอบตารางทั้งหมด', 'menuCheckAll')
    .addItem('เผยแพร่ตาราง', 'menuPublish')
    .addItem('ดูตารางรายวัน (เลือกวันที่)', 'menuDailyView')
    .addSeparator()
    .addItem('สำรองข้อมูลตอนนี้', 'menuBackupNow')
    .addItem('เปิดการสำรองข้อมูลอัตโนมัติรายวัน', 'menuInstallDailyBackup')
    .addToUi();
}

/** สร้างแผ่นงานทั้งหมด + นำเข้าข้อมูลเริ่มต้น (ถ้ายังว่าง) */
function firstTimeSetup() {
  var ui = SpreadsheetApp.getUi();
  var created = setupDatabase();
  var seeded = seedInitialData();
  ui.alert('ตั้งค่าครั้งแรกเสร็จแล้ว',
    'แผ่นงานที่สร้างใหม่: ' + (created.length ? created.join(', ') : 'ไม่มี (มีครบแล้ว)') + '\n\n' + seeded +
    '\n\nขั้นต่อไป: เมนู "2) เพิ่ม/เปลี่ยนรหัสผ่าน Admin"', ui.ButtonSet.OK);
}

/** สร้างแผ่นงานที่ยังไม่มีตาม SCHEMA — ไม่แตะแผ่นงานที่มีอยู่แล้ว */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(APP_TZ);
  var created = [];
  Object.keys(SCHEMA).forEach(function (table, idx) {
    var def = SCHEMA[table];
    var sh = ss.getSheetByName(def.sheet);
    if (sh) {
      var keys = sh.getRange(KEY_ROW, 1, 1, def.cols.length).getDisplayValues()[0];
      var mismatch = def.cols.some(function (c, i) { return keys[i] !== c.k; });
      if (mismatch) throw new Error('แผ่นงาน "' + def.sheet + '" มีอยู่แล้วแต่คอลัมน์ไม่ตรงกับระบบ — ไม่แก้ไขให้อัตโนมัติ กรุณาตรวจสอบ');
      return;
    }
    sh = ss.insertSheet(def.sheet, idx);
    var n = def.cols.length;
    if (sh.getMaxColumns() > n) sh.deleteColumns(n + 1, sh.getMaxColumns() - n);
    sh.getRange(LABEL_ROW, 1, 1, n).setValues([def.cols.map(function (c) { return c.label; })])
      .setFontWeight('bold').setBackground('#1D4ED8').setFontColor('#FFFFFF').setWrap(true).setVerticalAlignment('middle');
    sh.getRange(KEY_ROW, 1, 1, n).setValues([def.cols.map(function (c) { return c.k; })])
      .setFontSize(8).setFontColor('#6B7280').setBackground('#F3F4F6');
    sh.setFrozenRows(KEY_ROW);
    sh.setFrozenColumns(1);
    sh.setRowHeight(LABEL_ROW, 42);
    var dataRows = sh.getMaxRows() - DATA_START_ROW + 1;
    def.cols.forEach(function (c, i) {
      var rng = sh.getRange(DATA_START_ROW, i + 1, dataRows, 1);
      rng.setNumberFormat(c.type === 'bool' ? 'General' : '@');
      if (c.enumOf) {
        rng.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ENUMS[c.enumOf], true).setAllowInvalid(false).build());
      }
      sh.setColumnWidth(i + 1, c.type === 'json' ? 280 : (c.k === 'name' || c.k === 'message' || c.k === 'note' || c.k === 'description' ? 220 : 120));
    });
    var p = sh.getRange(LABEL_ROW, 1, 2, n).protect().setDescription('หัวตาราง — ห้ามแก้ไข');
    p.setWarningOnly(true);
    created.push(def.sheet);
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1') || ss.getSheetByName('ชีต1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  return created;
}

/** นำเข้าข้อมูลจริงเริ่มต้นจาก SeedData.gs — ทำเฉพาะเมื่อแผ่น "รายชื่อครู" ยังว่าง */
function seedInitialData() {
  if (Db.all('Teachers').length > 0) return 'มีข้อมูลอยู่แล้ว — ไม่ได้นำเข้าข้อมูลเริ่มต้นซ้ำ';
  var o = function (t, rows) { return rowsToObjects(t, rows); };
  var data = {
    settings: o('Settings', SEED.settings), terms: o('Terms', SEED.terms), classes: o('Classes', SEED.classes),
    periods: o('Periods', SEED.periods), teachers: o('Teachers', SEED.teachers), subjects: o('Subjects', SEED.subjects),
    requirements: o('Requirements', SEED.requirements), locks: o('Locks', SEED.locks), blocks: o('TeacherBlocks', SEED.blocks)
  };
  data.teacherSubjects = Rules.deriveTeacherSubjects(data.requirements);

  // ตรวจข้อมูลเริ่มต้นก่อนเขียน — ถ้าผิด ไม่เขียนอะไรเลย
  var checks = Rules.preScheduleChecks(data, '2569-2');
  if (!checks.ok) throw new Error('ข้อมูลเริ่มต้นไม่ผ่านการตรวจ: ' + checks.errors.map(function (e) { return e.message; }).join(' | '));

  return Db.withLock(function () {
    var ctx = { user: 'ระบบ (นำเข้าข้อมูลเริ่มต้น)', reason: 'ข้อมูลจากข้อกำหนดและคำตอบ Admin 7 ต.ค. 2569', unlockReason: 'นำเข้าข้อมูลเริ่มต้นของระบบ' };
    Db.insertMany('Settings', data.settings, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Terms', data.terms, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Classes', data.classes, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Periods', data.periods, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Teachers', data.teachers, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Subjects', data.subjects, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('TeacherSubjects', data.teacherSubjects, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Requirements', data.requirements, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('Locks', data.locks, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    Db.insertMany('TeacherBlocks', data.blocks, ctx, 'นำเข้าข้อมูลเริ่มต้น');
    return 'นำเข้าข้อมูลแล้ว: ครู ' + data.teachers.length + ' คน, วิชา ' + data.subjects.length + ' รายการ, โครงสร้างคาบ ' +
      data.requirements.length + ' แถว (ทุกชั้นครบ 30 คาบ), กิจกรรมล็อก ' + data.locks.length + ', เวลาไม่ว่างของครู ' + data.blocks.length + ' รายการ';
  });
}

function menuSetAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var u = ui.prompt('ชื่อผู้ใช้ Admin', 'อักษรอังกฤษ/ตัวเลข 3–30 ตัว เช่น admin', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  var n = ui.prompt('ชื่อที่แสดงใน Log', 'เช่น ครูณพิชญา', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt('รหัสผ่านใหม่', 'อย่างน้อย 8 ตัวอักษร (หน้าต่างนี้แสดงตัวอักษร — ระวังผู้อื่นมองเห็น)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  try {
    var msg = Auth.setPassword(u.getResponseText(), p.getResponseText(), n.getResponseText());
    Db.log({ user: 'เจ้าของไฟล์' }, 'ตั้งรหัสผ่าน Admin', 'Settings', u.getResponseText(), null, { username: u.getResponseText() });
    ui.alert(msg);
  } catch (e) { ui.alert('ไม่สำเร็จ: ' + e.message); }
}

function menuListAdmins() {
  var list = Auth.listUsers();
  SpreadsheetApp.getUi().alert(list.length ? list.map(function (x) { return x.username + ' — ' + x.name; }).join('\n') : 'ยังไม่มี Admin');
}

function menuPreChecks() {
  var data = Db.loadData();
  var cur = data.terms.filter(function (t) { return t.is_current; })[0];
  if (!cur) { SpreadsheetApp.getUi().alert('ยังไม่ได้ตั้งภาคเรียนปัจจุบัน'); return; }
  var res = Rules.preScheduleChecks(data, cur.term_id);
  saveCheckRun_(cur.term_id, res);
  var lines = Rules.periodSummary(data, cur.term_id).map(function (s) { return s.label; });
  lines.push('');
  lines.push(res.ok ? '✅ ข้อมูลพร้อมสำหรับจัดตาราง' : '❌ พบปัญหา ' + res.errors.length + ' รายการ — ยังสร้างตาราง Final ไม่ได้');
  res.errors.concat(res.warnings).slice(0, 15).forEach(function (x, i) { lines.push((i + 1) + '. [' + x.level + '] ' + x.message); });
  lines.push('', 'รายละเอียดทั้งหมดอยู่ในแผ่นงาน "ตรวจสอบระบบ"');
  SpreadsheetApp.getUi().alert('ตรวจข้อมูลภาคเรียน ' + cur.semester + '/' + cur.year, lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** บันทึกผลตรวจลงแผ่น "ตรวจสอบระบบ" */
function saveCheckRun_(termId, res) {
  var runId = 'RUN-' + Utilities.formatDate(new Date(), APP_TZ, 'yyyyMMdd-HHmmss');
  var at = Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd HH:mm:ss');
  var items = res.errors.concat(res.warnings);
  if (!items.length) items = [{ rule: 'ALL', level: 'ผ่าน', message: 'ไม่พบปัญหา', ref: '' }];
  var rows = items.map(function (x, i) {
    return { check_id: runId + '-' + (i + 1), run_id: runId, run_at: at, term_id: termId, rule: x.rule, level: x.level, message: x.message, ref: x.ref };
  });
  Db.withLock(function () { Db.insertMany('Validation', rows, { user: 'ระบบ' }, 'บันทึกผลตรวจ'); });
  return runId;
}
