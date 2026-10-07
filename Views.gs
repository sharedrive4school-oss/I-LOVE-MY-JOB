/**
 * Views.gs — แผ่น "ตารางรายชั้น" และ "ตารางครู" (มุมมองสำหรับอ่าน สร้างจาก Master ทุกครั้ง)
 *
 * แผ่นทั้งสองเป็นผลลัพธ์ ไม่ใช่ข้อมูลต้นทาง — ถูกล้างและสร้างใหม่ทุกครั้ง ห้ามแก้ไขในแผ่นนี้
 * (ข้อมูลจริงอยู่ที่ "ตารางเรียน_Master" เพียงที่เดียว)
 */

var Views = (function () {
  var CLASS_SHEET = 'ตารางรายชั้น', TEACHER_SHEET = 'ตารางครู';

  function prep(name) {
    var ss = Db.spreadsheet();
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
    return sh;
  }

  function render(termId, which) {
    var data = Db.loadData();
    var m = Master.get(termId, which === 'draft' ? { which: 'draft' } : { which: 'published' });
    if (!m.version) throw new AppError('NOT_FOUND', which === 'draft' ? 'ยังไม่มีตารางฉบับร่าง' : 'ยังไม่มีตารางที่เผยแพร่');
    var days = Rules.schoolDays(data);
    var periods = data.periods.filter(function (p) { return p.term_id === termId; })
      .sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; });
    var subj = {}; data.subjects.forEach(function (s) { subj[s.subject_id] = s; });
    var tch = {}; data.teachers.forEach(function (t) { tch[t.teacher_id] = t; });
    var cls = {}; data.classes.forEach(function (c) { cls[c.class_id] = c; });
    var term = Db.get('Terms', termId);
    var title = 'ภาคเรียนที่ ' + term.semester + '/' + term.year + ' · ' + (m.status === 'ร่าง' ? 'ฉบับร่าง ' : 'ฉบับเผยแพร่ ') + m.version +
      (m.effective_from ? ' · ใช้ตั้งแต่ ' + m.effective_from : '') + ' · สร้างเมื่อ ' + Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd HH:mm');
    var lockTeachers = {};
    m.locks.forEach(function (l) { lockTeachers[l.day + '-' + l.period] = l; });

    function grid(sh, startRow, heading, cellFn) {
      var header = ['เวลา'].concat(days.map(function (d) { return DAY_NAMES[d]; }));
      var rows = [[heading].concat(days.map(function () { return ''; })), header];
      var colors = [[null].concat(days.map(function () { return null; })), [null].concat(days.map(function () { return null; }))];
      periods.forEach(function (p) {
        var label = (p.type === 'พัก' ? p.label : 'คาบ ' + p.period_no) + '\n' + p.start_time + '–' + p.end_time;
        if (p.type === 'พัก') { rows.push([label].concat(days.map(function () { return 'พักกลางวัน'; }))); colors.push([null].concat(days.map(function () { return '#F3F4F6'; }))); return; }
        var r = [label], cr = [null];
        days.forEach(function (d) { var x = cellFn(d, p.period_no); r.push(x.text); cr.push(x.color); });
        rows.push(r); colors.push(cr);
      });
      var rg = sh.getRange(startRow, 1, rows.length, days.length + 1);
      rg.setValues(rows).setWrap(true).setVerticalAlignment('middle').setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
      rg.setBackgrounds(colors.map(function (r) { return r.map(function (c) { return c || '#FFFFFF'; }); }));
      sh.getRange(startRow, 1, 1, days.length + 1).merge().setFontWeight('bold').setFontSize(12).setBackground('#DBEAFE');
      sh.getRange(startRow + 1, 1, 1, days.length + 1).setFontWeight('bold').setBackground('#1D4ED8').setFontColor('#FFFFFF').setHorizontalAlignment('center');
      return startRow + rows.length + 1;
    }

    // ตารางรายชั้น
    var sc = prep(CLASS_SHEET);
    sc.getRange(1, 1).setValue('ตารางเรียนรายชั้น — ' + title + ' (แผ่นนี้สร้างอัตโนมัติ ห้ามแก้ไข)').setFontWeight('bold');
    var row = 3;
    Rules.periodSummary(data, termId).forEach(function (c) {
      row = grid(sc, row, cls[c.class_id].name, function (d, p) {
        var s = m.slots.filter(function (x) { return x.class_id === c.class_id && x.day === d && x.period === p; })[0];
        if (!s) return { text: '— ว่าง —', color: '#FEE2E2' };
        var who = s.teacher_id ? tch[s.teacher_id].short_name + (s.co_teacher_id ? ' + ' + tch[s.co_teacher_id].short_name : '') : 'ครูตามกิจกรรม';
        return { text: subj[s.subject_id].name + '\n' + who, color: subj[s.subject_id].color || null };
      });
    });
    sc.setColumnWidth(1, 110); for (var i = 2; i <= days.length + 1; i++) sc.setColumnWidth(i, 170);

    // ตารางครู
    var st = prep(TEACHER_SHEET);
    st.getRange(1, 1).setValue('ตารางสอนรายครู — ' + title + ' (แผ่นนี้สร้างอัตโนมัติ ห้ามแก้ไข)').setFontWeight('bold');
    row = 3;
    data.teachers.filter(function (t) { return t.status === 'ใช้งาน'; }).forEach(function (t) {
      var mine = m.slots.filter(function (s) { return s.teacher_id === t.teacher_id || s.co_teacher_id === t.teacher_id; });
      var inLock = m.locks.filter(function (l) { return Rules.splitIds(l.teacher_ids).indexOf(t.teacher_id) >= 0; });
      if (!mine.length && !inLock.length) return;
      row = grid(st, row, t.name + ' — ' + (mine.length + inLock.length) + ' คาบ/สัปดาห์', function (d, p) {
        var s = mine.filter(function (x) { return x.day === d && x.period === p; })[0];
        if (s) return { text: subj[s.subject_id].name + '\n' + cls[s.class_id].name + (s.co_teacher_id === t.teacher_id ? ' (ประกบ)' : ''), color: subj[s.subject_id].color || null };
        var l = inLock.filter(function (x) { return x.day === d && x.period === p; })[0];
        if (l) return { text: subj[l.subject_id].name + '\n(กิจกรรมรวม)', color: subj[l.subject_id].color || null };
        return { text: '', color: null };
      });
    });
    st.setColumnWidth(1, 110); for (var j = 2; j <= days.length + 1; j++) st.setColumnWidth(j, 170);
    return { version: m.version, status: m.status };
  }

  return { render: render };
})();

// ---------- เมนูใน Google Sheets (เจ้าของไฟล์) ----------

function currentTermId_() {
  var t = Db.all('Terms').filter(function (x) { return x.is_current; })[0];
  if (!t) throw new Error('ยังไม่ได้ตั้งภาคเรียนปัจจุบัน');
  return t.term_id;
}

function menuGenerateSchedule() {
  var ui = SpreadsheetApp.getUi();
  try {
    var termId = currentTermId_();
    var ctx = { user: 'เจ้าของไฟล์ (เมนู Sheets)' };
    var g = Master.generateDraft(ctx, { term_id: termId });
    var saved = Master.saveDraft(ctx, { term_id: termId, slots: g.slots, reason: 'จัดตารางอัตโนมัติจากเมนู' });
    Views.render(termId, 'draft');
    ui.alert('จัดตารางเสร็จ (ฉบับร่าง ' + saved.version + ')',
      '✅ ไม่พบความขัดแย้ง — บันทึก ' + saved.count + ' คาบ\n\n' + g.notes.join('\n') +
      '\n\nดูผลได้ที่แผ่น "ตารางรายชั้น" และ "ตารางครู"\nตารางยังไม่เผยแพร่ — ครูทั่วไปยังไม่เห็น', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('จัดตารางไม่สำเร็จ', e.message + (e.details && e.details.length && e.details[0].message ? '\n\n' + e.details.slice(0, 15).map(function (x, i) { return (i + 1) + '. ' + x.message; }).join('\n') : ''), ui.ButtonSet.OK);
  }
}

function menuCheckAll() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Master.checkAll({ user: 'เจ้าของไฟล์ (เมนู Sheets)' }, { term_id: currentTermId_() });
    ui.alert('ตรวจสอบตารางทั้งหมด (ฉบับร่าง ' + r.version + ')', r.message + '\n\n' +
      r.errors.concat(r.warnings).slice(0, 20).map(function (x, i) { return (i + 1) + '. [' + x.level + '] ' + x.message; }).join('\n'), ui.ButtonSet.OK);
  } catch (e) { ui.alert('ตรวจไม่สำเร็จ: ' + e.message); }
}

function menuPublish() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('เผยแพร่ตาราง', 'เผยแพร่ตารางฉบับร่างล่าสุดให้ครูทุกคนเห็น โดยเริ่มใช้วันนี้?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  try {
    var termId = currentTermId_();
    var r = Master.publish({ user: 'เจ้าของไฟล์ (เมนู Sheets)' }, { term_id: termId });
    Views.render(termId, 'published');
    ui.alert(r.message);
  } catch (e) { ui.alert('เผยแพร่ไม่ได้', e.message, ui.ButtonSet.OK); }
}

/** เมนู: ดูตารางรายวันของวันที่ที่เลือก (สร้างแผ่น "มุมมองตารางรายวัน" ใหม่ทุกครั้ง) */
function menuDailyView() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('ดูตารางรายวัน', 'พิมพ์วันที่แบบ ปปปป-ดด-วว (ค.ศ.) เช่น 2026-11-18', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    var day = Daily.get(r.getResponseText().trim());
    var ss = Db.spreadsheet();
    var sh = ss.getSheetByName('มุมมองตารางรายวัน') || ss.insertSheet('มุมมองตารางรายวัน');
    sh.clear();
    var head = 'วัน' + day.day_name + 'ที่ ' + day.date + ' · ' + (day.term_id ? 'ภาคเรียน ' + day.semester + '/' + day.year : 'นอกภาคเรียน') +
      ' · ' + day.day_type + (day.note ? ' · ' + day.note : '') + ' (แผ่นนี้สร้างอัตโนมัติ ห้ามแก้ไข)';
    sh.getRange(1, 1).setValue(head).setFontWeight('bold');
    var row = 3;
    if (day.absent.length) {
      sh.getRange(row++, 1).setValue('ครูที่ไม่อยู่').setFontWeight('bold');
      day.absent.forEach(function (a) { sh.getRange(row++, 1, 1, 3).setValues([[a.name, a.type, a.periods + (a.note ? ' · ' + a.note : '')]]); });
      row++;
    }
    day.classes.forEach(function (c) {
      sh.getRange(row++, 1).setValue(c.name).setFontWeight('bold').setBackground('#DBEAFE');
      var rows = [['คาบ', 'วิชา', 'ครู', 'สถานะ', 'หมายเหตุ']];
      c.slots.forEach(function (s) {
        rows.push([s.period, s.subject, s.teacher + (s.co_teacher ? ' + ' + s.co_teacher : '') + (s.original_teacher ? ' (แทน ' + s.original_teacher + ')' : ''), s.status, s.note]);
      });
      sh.getRange(row, 1, rows.length, 5).setValues(rows);
      row += rows.length + 1;
    });
    if (!day.classes.length) sh.getRange(row, 1).setValue('ไม่มีการเรียนการสอนในวันนี้');
    ss.setActiveSheet(sh);
    if (!day.check.ok) ui.alert('พบความขัดแย้งในวันนี้', day.check.errors.map(function (e) { return e.message; }).join('\n'), ui.ButtonSet.OK);
  } catch (e) { ui.alert('แสดงไม่ได้: ' + e.message); }
}
