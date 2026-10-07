/**
 * Web.gs — ข้อมูลสำหรับหน้าเว็บ (Phase 10): หน้าหลัก, โครงสร้างตารางสำหรับฟอร์ม Admin, อ่านตารางข้อมูล
 */

var Web = (function () {

  function today() { return Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd'); }

  /** หน้าหลัก (ข้อ 41) */
  function dashboard(isAdmin) {
    var data = Db.loadData();
    var date = today();
    var cur = data.terms.filter(function (t) { return t.is_current; })[0] || null;
    var out = {
      date: date, term: cur, teachers: data.teachers.filter(function (t) { return t.status === 'ใช้งาน'; }).length,
      classes: 0, absent_today: [], periods_today: 0, subs_today: 0, waiting_today: 0,
      day: null, schedule: null, check: null, alerts: []
    };
    out.classes = data.classes.filter(function (c) { return c.status === 'ใช้งาน' && c.in_timetable; }).length;
    try {
      var day = Daily.get(date, null, isAdmin);
      out.day = { day_name: day.day_name, is_school_day: day.is_school_day, day_type: day.day_type, note: day.note, term_id: day.term_id };
      out.absent_today = day.absent;
      day.classes.forEach(function (c) { c.slots.forEach(function (s) { if (s.status !== 'ยกเลิก') out.periods_today++; }); });
      out.subs_today = day.counts.substituted;
      out.waiting_today = day.counts.waiting;
      if (day.counts.waiting) out.alerts.push({ level: 'warn', text: 'วันนี้มี ' + day.counts.waiting + ' คาบที่รอจัดสอนแทน' });
      if (!day.check.ok) out.alerts.push({ level: 'error', text: 'ตารางวันนี้พบความขัดแย้ง ' + day.check.errors.length + ' รายการ' });
    } catch (e) { out.alerts.push({ level: 'warn', text: 'อ่านตารางวันนี้ไม่ได้: ' + e.message }); }
    if (cur) {
      var vs = Master.versions(cur.term_id);
      var pub = vs.filter(function (v) { return v.status === 'เผยแพร่แล้ว'; })[0] || null;
      var draft = vs.filter(function (v) { return v.status === 'ร่าง'; }).pop() || null;
      out.schedule = { status: cur.schedule_status, published: pub, draft: draft };
      var pre = Rules.preScheduleChecks(data, cur.term_id);
      var errs = pre.errors.slice(), warns = pre.warnings.slice();
      if (pub) {
        var v = ScheduleValidator.validateSchedule(data, cur.term_id, Master.get(cur.term_id, { version: pub.version }).slots);
        errs = errs.concat(v.errors); warns = warns.concat(v.warnings);
      }
      out.check = { ok: errs.length === 0, errors: errs.length, warnings: warns.length,
        items: isAdmin ? errs.concat(warns).slice(0, 30) : [] };
      if (!pub) out.alerts.push({ level: 'warn', text: 'ภาคเรียนนี้ยังไม่ได้เผยแพร่ตารางสอน' });
      if (cur.schedule_status === 'ต้องตรวจสอบใหม่') out.alerts.push({ level: 'warn', text: 'โครงสร้างคาบเปลี่ยนหลังเผยแพร่ — Admin ควรตรวจสอบตารางใหม่' });
      if (errs.length) out.alerts.push({ level: 'error', text: 'ตรวจพบปัญหาในข้อมูล/ตาราง ' + errs.length + ' รายการ' });
      if (!cur.start_date || !cur.end_date) out.alerts.push({ level: 'warn', text: 'ยังไม่ได้กรอกวันเปิด-ปิดภาคเรียน' });
    } else {
      out.alerts.push({ level: 'error', text: 'ยังไม่ได้ตั้งภาคเรียนปัจจุบัน' });
    }
    return out;
  }

  /** นิยามตาราง/คอลัมน์สำหรับฟอร์ม Admin (ไม่มีข้อมูลลับ) */
  function schema() {
    var out = {};
    ADMIN_EDITABLE.forEach(function (t) {
      var def = SCHEMA[t];
      out[t] = {
        table: t, sheet: def.sheet, key: def.key, auto_id: !!def.idPrefix, no_delete: NO_DELETE.indexOf(t) >= 0,
        cols: def.cols.map(function (c) {
          return { k: c.k, label: c.label, type: c.type, required: !!c.required, options: c.enumOf ? ENUMS[c.enumOf] : null,
            ref: def.refs && def.refs[c.k] ? def.refs[c.k] : null };
        })
      };
    });
    return { tables: out, enums: ENUMS };
  }

  /** อ่านข้อมูลหนึ่งตาราง (Admin) — กรองตามภาคเรียนถ้าตารางมี term_id */
  function table(payload) {
    var t = payload.table;
    if (ADMIN_EDITABLE.indexOf(t) < 0) throw new AppError('FORBIDDEN', 'อ่านตารางนี้ไม่ได้');
    var rows = Db.all(t);
    var hasTerm = SCHEMA[t].cols.some(function (c) { return c.k === 'term_id'; });
    if (hasTerm && payload.term_id && t !== 'Terms') rows = rows.filter(function (r) { return r.term_id === payload.term_id || (t === 'Calendar' && !r.term_id); });
    return rows;
  }

  /** ฉบับร่างของตาราง Master ทั้งหมดของภาคเรียน + ผลตรวจ (หน้าแก้ตาราง) */
  function draftWithCheck(termId) {
    var m = Master.get(termId, { which: 'draft' });
    if (!m.version) return m;
    m.check = ScheduleValidator.validateSchedule(Db.loadData(), termId, m.slots);
    return m;
  }

  return { dashboard: dashboard, schema: schema, table: table, draftWithCheck: draftWithCheck, today: today };
})();
