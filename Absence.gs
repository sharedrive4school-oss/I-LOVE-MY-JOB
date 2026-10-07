/**
 * Absence.gs — บันทึกครูไม่อยู่ (Phase 8, ข้อ 28)
 *
 * - เลือกวันที่ (หรือช่วงวันที่) ครู ประเภท ทั้งวัน/บางคาบ หมายเหตุ
 * - ช่วงหลายวัน: สร้างหนึ่งรายการต่อ "วันเรียน" (ข้ามเสาร์-อาทิตย์และวันหยุดในปฏิทิน)
 * - ห้ามบันทึกซ้อนกับรายการเดิมของครูคนเดียวกัน
 * - ถ้าครูคนนั้นถูกจัดเป็นผู้สอนแทนในช่วงเวลานั้นอยู่แล้ว → ไม่บันทึก และแจ้งให้ยกเลิกการสอนแทนก่อน
 * - ยกเลิกรายการครูไม่อยู่ → ยกเลิกการสอนแทนที่เกี่ยวข้องด้วย (บันทึก Log ทุกรายการ)
 */

var Absence = (function () {
  var MAX_DAYS = 60;

  function periodsText(a) {
    if (a.whole_day) return 'ทั้งวัน';
    return a.period_from === a.period_to ? 'คาบ ' + a.period_from : 'คาบ ' + a.period_from + '–' + a.period_to;
  }

  function overlaps(a, b) {
    if (a.date !== b.date) return false;
    if (a.whole_day || b.whole_day) return true;
    return Number(a.period_from) <= Number(b.period_to) && Number(b.period_from) <= Number(a.period_to);
  }

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }

  /** payload: { date, date_to?, teacher_id, type, whole_day, period_from?, period_to?, note, reason } */
  function save(ctx, payload) {
    var from = String(payload.date || ''), to = String(payload.date_to || payload.date || '');
    if (!Rules.isIsoDate(from) || !Rules.isIsoDate(to) || to < from) throw new AppError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    if (ENUMS.ABSENCE_TYPE.indexOf(payload.type) < 0) throw new AppError('VALIDATION', 'ประเภทการไม่อยู่ต้องเป็นหนึ่งใน: ' + ENUMS.ABSENCE_TYPE.join(', '));
    var whole = payload.whole_day === true || payload.whole_day === 'true';
    var pf = whole ? '' : Number(payload.period_from), pt = whole ? '' : Number(payload.period_to || payload.period_from);
    if (!whole && (!(pf >= 1) || !(pt >= pf))) throw new AppError('VALIDATION', 'ระบุคาบเริ่มต้นและคาบสิ้นสุดให้ถูกต้อง');
    var c = { user: ctx.user, reason: payload.reason || payload.note || 'บันทึกครูไม่อยู่' };

    return Db.withLock(function () {
      var data = Db.loadData();
      var t = Db.get('Teachers', payload.teacher_id);
      if (!t) throw new AppError('VALIDATION', 'ไม่พบครู ' + payload.teacher_id);
      var dates = [], skipped = [];
      for (var i = 0, d = from; d <= to; i++, d = addDays(from, i)) {
        if (i >= MAX_DAYS) throw new AppError('VALIDATION', 'บันทึกได้ครั้งละไม่เกิน ' + MAX_DAYS + ' วัน');
        var info = Rules.describeDate(data, d);
        if (info.is_school_day) dates.push(d); else skipped.push(d + ' (' + info.day_type + ')');
      }
      if (!dates.length) throw new AppError('VALIDATION', 'ช่วงวันที่ที่เลือกไม่มีวันเรียน');
      var existing = Db.all('Absences').filter(function (a) { return a.teacher_id === t.teacher_id && a.status === 'ใช้งาน'; });
      var subs = Db.all('Substitutions').filter(function (u) { return u.substitute_teacher_id === t.teacher_id && u.status === 'ยืนยันแล้ว'; });
      var master = {};
      var problems = [];
      var recs = dates.map(function (d) {
        var rec = { date: d, teacher_id: t.teacher_id, type: payload.type, whole_day: whole, period_from: pf, period_to: pt,
          note: payload.note || '', status: 'ใช้งาน', created_by: ctx.user, created_at: Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd HH:mm:ss') };
        existing.forEach(function (a) { if (overlaps(a, rec)) problems.push(d + ': ' + t.name + ' มีรายการไม่อยู่แล้ว (' + a.type + ' ' + periodsText(a) + ')'); });
        subs.filter(function (u) { return u.date === d; }).forEach(function (u) {
          master[u.term_id] = master[u.term_id] || Db.all('Master');
          var slot = master[u.term_id].filter(function (m) { return m.slot_id === u.slot_id; })[0];
          if (slot && DailyRules.absenceCovers(rec, Number(slot.period)))
            problems.push(d + ' คาบ ' + slot.period + ': ' + t.name + ' ถูกจัดสอนแทนอยู่ (' + u.sub_id + ') — ยกเลิกการสอนแทนก่อน');
        });
        return rec;
      });
      if (problems.length) throw new AppError('CONFLICT', 'ไม่สามารถบันทึกได้\n' + problems.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n'), problems);
      var saved = Db.insertMany('Absences', recs, c, 'บันทึกครูไม่อยู่');
      return { saved: saved, skipped: skipped };
    });
  }

  /** ยกเลิกรายการครูไม่อยู่ + การสอนแทนที่เกี่ยวข้อง */
  function cancel(ctx, payload) {
    if (!payload.reason) throw new AppError('VALIDATION', 'กรุณาระบุเหตุผล');
    var c = { user: ctx.user, reason: payload.reason };
    return Db.withLock(function () {
      var a = Db.get('Absences', payload.absence_id);
      if (!a || a.status !== 'ใช้งาน') throw new AppError('NOT_FOUND', 'ไม่พบรายการที่ใช้งานอยู่');
      Db.update('Absences', a.absence_id, { status: 'ยกเลิก' }, c);
      var subIds = Db.all('Substitutions').filter(function (u) { return u.absence_id === a.absence_id && u.status === 'ยืนยันแล้ว'; }).map(function (u) { return u.sub_id; });
      if (subIds.length) {
        Db.updateWhere('Substitutions', function (u) { return subIds.indexOf(u.sub_id) >= 0; }, { status: 'ยกเลิก' }, c, 'ยกเลิกการสอนแทน (ครูกลับมา)');
        Db.updateWhere('DailyChanges', function (x) { return subIds.indexOf(x.sub_id) >= 0 && x.status === 'ใช้งาน'; }, { status: 'ยกเลิก' }, c, 'ยกเลิกการสอนแทน (ครูกลับมา)');
      }
      return { absence_id: a.absence_id, cancelled_substitutions: subIds.length };
    });
  }

  /** รายการครูไม่อยู่ (ช่วงวันที่) — ข้อมูลส่วนตัวในหมายเหตุแสดงเฉพาะ Admin */
  function list(fromDate, toDate, includeNote) {
    var teachers = {}; Db.all('Teachers').forEach(function (t) { teachers[t.teacher_id] = t; });
    return Db.all('Absences').filter(function (a) {
      return a.status === 'ใช้งาน' && (!fromDate || a.date >= fromDate) && (!toDate || a.date <= toDate);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).map(function (a) {
      return { absence_id: a.absence_id, date: a.date, teacher_id: a.teacher_id, name: teachers[a.teacher_id] ? teachers[a.teacher_id].name : a.teacher_id,
        type: a.type, periods: periodsText(a), note: includeNote ? a.note : '' };
    });
  }

  return { save: save, cancel: cancel, list: list };
})();
