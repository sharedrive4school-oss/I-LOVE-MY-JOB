/**
 * Daily.gs — ตารางรายวัน (Phase 7)
 *
 * ตารางรายวัน = ตาราง Master ฉบับที่ใช้ในวันนั้น + การเปลี่ยนแปลงเฉพาะวัน + ครูไม่อยู่ + การสอนแทนที่ยืนยันแล้ว
 * คำนวณใหม่ทุกครั้งที่เปิดดู และ "ไม่แก้ไข Master" (ข้อ 27)
 *
 * DailyRules = ฟังก์ชันบริสุทธิ์ (ทดสอบในเครื่องได้) · Daily = ส่วนที่อ่าน/เขียน Google Sheets
 */

var DailyRules = (function () {

  function absenceCovers(a, period) {
    if (a.whole_day === true) return true;
    var from = a.period_from === null || a.period_from === '' ? -Infinity : Number(a.period_from);
    var to = a.period_to === null || a.period_to === '' ? Infinity : Number(a.period_to);
    return period >= from && period <= to;
  }

  function absenceLabel(a) {
    if (a.whole_day === true) return 'ทั้งวัน';
    if (a.period_from === a.period_to) return 'คาบ ' + a.period_from;
    return 'คาบ ' + a.period_from + '–' + a.period_to;
  }

  /**
   * สร้างตารางของวันที่ isoDate
   * extra: { masterSlots, version, locks, changes, absences, substitutions }
   */
  function build(data, isoDate, extra) {
    var R = Rules;
    var info = R.describeDate(data, isoDate);
    var teachers = {}; (data.teachers || []).forEach(function (t) { teachers[t.teacher_id] = t; });
    var subjects = {}; (data.subjects || []).forEach(function (s) { subjects[s.subject_id] = s; });
    var out = {
      date: isoDate, day: info.day, day_name: info.day_name, term_id: info.term_id, year: info.year, semester: info.semester,
      is_school_day: info.is_school_day, day_type: info.day_type, note: info.note,
      version: extra.version || null, periods: [], classes: [], absent: [], counts: { changed: 0, substituted: 0, waiting: 0, cancelled: 0 }
    };
    var absences = (extra.absences || []).filter(function (a) { return a.date === isoDate && a.status === 'ใช้งาน'; });
    out.absent = absences.map(function (a) {
      return { absence_id: a.absence_id, teacher_id: a.teacher_id, name: teachers[a.teacher_id] ? teachers[a.teacher_id].name : a.teacher_id,
        type: a.type, periods: absenceLabel(a), note: a.note || '' };
    });
    if (!info.term_id || !info.is_school_day) return out;
    if (!out.version) { out.note = (out.note ? out.note + ' · ' : '') + 'ยังไม่มีตารางที่เผยแพร่สำหรับวันนี้'; return out; }

    out.periods = (data.periods || []).filter(function (p) { return p.term_id === info.term_id; })
      .sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; })
      .map(function (p) { return { period_no: p.period_no, start_time: p.start_time, end_time: p.end_time, type: p.type, label: p.label }; });

    var changes = {};
    (extra.changes || []).filter(function (c) { return c.date === isoDate && c.status === 'ใช้งาน' && c.change_type !== 'สอนแทน'; })
      .forEach(function (c) { changes[c.slot_id] = c; });
    var subs = {};
    (extra.substitutions || []).filter(function (u) { return u.date === isoDate && u.status === 'ยืนยันแล้ว'; })
      .forEach(function (u) { subs[u.slot_id + '|' + u.role] = u; });
    function absentAt(t, p) { return t && absences.some(function (a) { return a.teacher_id === t && absenceCovers(a, p); }); }
    function tname(id) { return id && teachers[id] ? teachers[id].short_name : ''; }

    var todays = (extra.masterSlots || []).filter(function (s) { return Number(s.day) === info.day; });
    var lockByPeriod = {};
    (extra.locks || []).filter(function (l) { return Number(l.day) === info.day; }).forEach(function (l) { lockByPeriod[l.period] = l; });

    R.periodSummary(data, info.term_id).forEach(function (c) {
      var cls = { class_id: c.class_id, name: c.name, slots: [] };
      todays.filter(function (s) { return s.class_id === c.class_id; })
        .sort(function (a, b) { return a.period - b.period; })
        .forEach(function (s) {
          var row = {
            slot_id: s.slot_id, period: Number(s.period), subject_id: s.subject_id, subject: subjects[s.subject_id] ? subjects[s.subject_id].name : s.subject_id,
            teacher_id: s.teacher_id || '', co_teacher_id: s.co_teacher_id || '', original_teacher_id: '', original_co_teacher_id: '',
            status: 'ปกติ', note: '', change_id: '', sub_ids: []
          };
          var ch = changes[s.slot_id];
          if (ch) {
            row.change_id = ch.change_id; row.note = ch.note || ''; out.counts.changed++;
            if (ch.change_type === 'ยกเลิกคาบ') { row.status = 'ยกเลิก'; row.teacher_id = ''; row.co_teacher_id = ''; out.counts.cancelled++; }
            else {
              row.status = ch.change_type === 'กิจกรรมพิเศษ' ? 'กิจกรรมพิเศษ' : 'เปลี่ยนแปลง';
              if (ch.new_subject_id) { row.subject_id = ch.new_subject_id; row.subject = subjects[ch.new_subject_id] ? subjects[ch.new_subject_id].name : ch.new_subject_id; }
              if (ch.new_teacher_id !== undefined && ch.new_teacher_id !== '') { row.original_teacher_id = row.teacher_id; row.teacher_id = ch.new_teacher_id; row.co_teacher_id = ''; row.assigned_by_change = true; }
            }
          }
          if (row.status !== 'ยกเลิก') {
            [['teacher_id', 'original_teacher_id', 'ผู้สอน'], ['co_teacher_id', 'original_co_teacher_id', 'ผู้ประกบ']].forEach(function (f) {
              var t = row[f[0]];
              if (!t || !absentAt(t, row.period)) return;
              if (row.assigned_by_change && f[0] === 'teacher_id') return; // Admin เลือกครูที่ไม่อยู่เอง → ให้ validateDay ปฏิเสธ
              var u = subs[s.slot_id + '|' + f[2]];
              if (u) {
                row[f[1]] = t; row[f[0]] = u.substitute_teacher_id; row.sub_ids.push(u.sub_id);
                if (f[0] === 'teacher_id' && row.co_teacher_id === u.substitute_teacher_id) {
                  // ครูประกบของคาบนี้รับสอนแทน → ไม่มีผู้ประกบในคาบนี้
                  row.original_co_teacher_id = row.co_teacher_id; row.co_teacher_id = '';
                  row.note = (row.note ? row.note + ' · ' : '') + 'ครูประกบสอนแทน';
                }
                if (row.status === 'ปกติ') row.status = 'สอนแทน';
                out.counts.substituted++;
              } else {
                row.status = 'รอจัดสอนแทน';
                row.note = (row.note ? row.note + ' · ' : '') + tname(t) + ' ไม่อยู่ (' + f[2] + ')';
                out.counts.waiting++;
              }
            });
            if (s.source === 'ล็อก' && lockByPeriod[row.period]) {
              var gone = R.splitIds(lockByPeriod[row.period].teacher_ids).filter(function (t) { return absentAt(t, row.period); });
              if (gone.length) row.note = (row.note ? row.note + ' · ' : '') + 'ครูกิจกรรมไม่อยู่: ' + gone.map(tname).join(', ');
            }
          }
          row.teacher = tname(row.teacher_id) || (s.source === 'ล็อก' ? 'ครูตามกิจกรรม' : '');
          row.co_teacher = tname(row.co_teacher_id);
          row.original_teacher = tname(row.original_teacher_id);
          row.original_co_teacher = tname(row.original_co_teacher_id);
          cls.slots.push(row);
        });
      out.classes.push(cls);
    });
    return out;
  }

  /** ตรวจตารางรายวัน: ครูชน, ครูที่ไม่อยู่ถูกจัดสอน, ครูถูกจัดในช่วงไม่ว่างประจำ */
  function validateDay(data, day, extra) {
    var errors = [], warnings = [];
    if (!day.is_school_day || !day.version) return { ok: true, errors: errors, warnings: warnings };
    var teachers = {}; (data.teachers || []).forEach(function (t) { teachers[t.teacher_id] = t; });
    function tn(id) { return teachers[id] ? teachers[id].name : id; }
    var absences = (extra.absences || []).filter(function (a) { return a.date === day.date && a.status === 'ใช้งาน'; });
    var at = {};
    function use(t, p, what) { if (!t) return; var k = t + '|' + p; (at[k] = at[k] || []).push(what); }
    day.classes.forEach(function (c) {
      c.slots.forEach(function (s) {
        if (s.status === 'ยกเลิก') return;
        function isAbsent(t) { return absences.some(function (a) { return a.teacher_id === t && absenceCovers(a, s.period); }); }
        // คาบที่รอจัดสอนแทน: ครูที่ไม่อยู่ไม่ได้ใช้เวลานั้นจริง จึงไม่นับเป็นการชน
        if (!(s.status === 'รอจัดสอนแทน' && isAbsent(s.teacher_id))) use(s.teacher_id, s.period, c.name);
        if (!(s.status === 'รอจัดสอนแทน' && isAbsent(s.co_teacher_id))) use(s.co_teacher_id, s.period, c.name + ' (ประกบ)');
        [s.teacher_id, s.co_teacher_id].forEach(function (t) {
          if (t && (s.status !== 'รอจัดสอนแทน' || s.assigned_by_change) && isAbsent(t))
            errors.push({ rule: 'D04', level: 'ผิด', message: 'วัน' + day.day_name + ' คาบ ' + s.period + ' — ' + tn(t) + ' ไม่อยู่ แต่ถูกจัดสอน ' + c.name });
          if (t) {
            var b = Rules.blockedSlots(data, day.term_id, t);
            if (b[Rules.slotKey(day.day, s.period)]) errors.push({ rule: 'D04', level: 'ผิด', message: 'คาบ ' + s.period + ' — ' + tn(t) + ' ไม่ว่างในช่วงนี้ แต่ถูกจัดสอน ' + c.name });
          }
        });
        if (s.status === 'รอจัดสอนแทน') warnings.push({ rule: 'D12', level: 'เตือน', message: c.name + ' คาบ ' + s.period + ' ' + s.subject + ': ' + s.note });
      });
    });
    (extra.locks || []).filter(function (l) { return Number(l.day) === day.day; }).forEach(function (l) {
      Rules.splitIds(l.teacher_ids).forEach(function (t) { use(t, Number(l.period), 'กิจกรรมรวม'); });
    });
    Object.keys(at).forEach(function (k) {
      var list = at[k];
      var uniq = list.filter(function (x, i) { return list.indexOf(x) === i; });
      if (uniq.length > 1) {
        var p = k.split('|');
        errors.push({ rule: 'D02', level: 'ผิด', message: 'วัน' + day.day_name + ' คาบ ' + p[1] + ' — ' + tn(p[0]) + ' ถูกจัดให้สอน ' + uniq.join(' และ ') + ' พร้อมกัน' });
      }
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  return { build: build, validateDay: validateDay, absenceCovers: absenceCovers };
})();

/** ส่วนที่ใช้ Google Sheets */
var Daily = (function () {

  function extraFor(termId, isoDate) {
    var v = termId ? Master.versionForDate(termId, isoDate) : null;
    var m = v ? Master.get(termId, { version: v }) : { slots: [], locks: [] };
    return {
      version: v, masterSlots: m.slots, locks: m.locks,
      changes: Db.all('DailyChanges'), absences: Db.all('Absences'), substitutions: Db.all('Substitutions')
    };
  }

  /** ตารางของวันที่ (ทุกคนดูได้) — ถ้าระบุ teacher_id จะคืนเฉพาะคาบของครูคนนั้นด้วย */
  function get(isoDate, teacherId, includePrivate) {
    if (!Rules.isIsoDate(isoDate)) throw new AppError('VALIDATION', 'วันที่ไม่ถูกต้อง (ใช้รูปแบบ ปปปป-ดด-วว)');
    var data = Db.loadData();
    var info = Rules.describeDate(data, isoDate);
    var extra = extraFor(info.term_id, isoDate);
    var day = DailyRules.build(data, isoDate, extra);
    day.check = DailyRules.validateDay(data, day, extra);
    if (!includePrivate) day.absent.forEach(function (a) { a.note = ''; }); // หมายเหตุการลาเห็นเฉพาะ Admin
    if (teacherId) {
      var mine = [];
      day.classes.forEach(function (c) {
        c.slots.forEach(function (s) {
          var role = s.teacher_id === teacherId ? 'สอน' : s.co_teacher_id === teacherId ? 'ประกบ' : null;
          var was = s.original_teacher_id === teacherId || s.original_co_teacher_id === teacherId;
          if (role || was) mine.push({ class_id: c.class_id, class_name: c.name, period: s.period, subject: s.subject, role: role || 'มีผู้สอนแทน', status: s.status, note: s.note, slot_id: s.slot_id });
        });
      });
      (extra.locks || []).filter(function (l) { return Number(l.day) === day.day && Rules.splitIds(l.teacher_ids).indexOf(teacherId) >= 0; }).forEach(function (l) {
        var sub = Rules.byKey(data.subjects, 'subject_id', l.subject_id);
        mine.push({ class_id: '', class_name: 'กิจกรรมรวม', period: Number(l.period), subject: sub ? sub.name : l.subject_id, role: 'กิจกรรม', status: 'ปกติ', note: '' });
      });
      day.teacher = { teacher_id: teacherId, slots: mine.sort(function (a, b) { return a.period - b.period; }) };
    }
    return day;
  }

  /**
   * บันทึกการเปลี่ยนแปลงเฉพาะวัน (ยกเลิกคาบ / กิจกรรมพิเศษ / สลับคาบ) — ตรวจก่อนบันทึก ปฏิเสธถ้าเกิดความขัดแย้ง
   * payload: { date, slot_id, change_type, new_teacher_id?, new_subject_id?, note, reason }
   * การสอนแทนบันทึกผ่านระบบจัดสอนแทน (Phase 9) เท่านั้น
   */
  function saveChange(ctx, payload) {
    var isoDate = String(payload.date || '');
    if (!Rules.isIsoDate(isoDate)) throw new AppError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    if (['ยกเลิกคาบ', 'กิจกรรมพิเศษ', 'สลับคาบ'].indexOf(payload.change_type) < 0) throw new AppError('VALIDATION', 'ประเภทการเปลี่ยนแปลงไม่ถูกต้อง');
    if (!payload.reason && !payload.note) throw new AppError('VALIDATION', 'กรุณาระบุเหตุผล');
    var c = { user: ctx.user, reason: payload.reason || payload.note, unlockReason: payload.unlockReason || '' };
    return Db.withLock(function () {
      var data = Db.loadData();
      var info = Rules.describeDate(data, isoDate);
      if (!info.term_id) throw new AppError('VALIDATION', 'วันที่นี้ไม่อยู่ในภาคเรียนใด');
      if (!info.is_school_day) throw new AppError('VALIDATION', 'วันที่นี้ไม่ใช่วันเรียน (' + info.day_type + ')');
      var extra = extraFor(info.term_id, isoDate);
      var slot = extra.masterSlots.filter(function (s) { return s.slot_id === payload.slot_id; })[0];
      if (!slot || Number(slot.day) !== info.day) throw new AppError('VALIDATION', 'คาบที่เลือกไม่อยู่ในตารางของวันที่นี้');
      var rec = {
        date: isoDate, term_id: info.term_id, slot_id: slot.slot_id, change_type: payload.change_type,
        new_teacher_id: payload.new_teacher_id || '', new_subject_id: payload.new_subject_id || '', sub_id: '',
        note: payload.note || '', status: 'ใช้งาน', created_by: ctx.user, created_at: Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd HH:mm:ss')
      };
      var others = extra.changes.filter(function (x) { return !(x.date === isoDate && x.slot_id === slot.slot_id && x.status === 'ใช้งาน' && x.change_type !== 'สอนแทน'); });
      var trialExtra = {}; for (var k in extra) trialExtra[k] = extra[k];
      trialExtra.changes = others.concat([rec]);
      var day = DailyRules.build(data, isoDate, trialExtra);
      var check = DailyRules.validateDay(data, day, trialExtra);
      if (!check.ok) throw new AppError('CONFLICT', 'ไม่สามารถบันทึกการเปลี่ยนแปลงได้\n' + check.errors.map(function (e, i) { return (i + 1) + '. ' + e.message; }).join('\n'), check.errors);
      Db.updateWhere('DailyChanges', function (x) { return x.date === isoDate && x.slot_id === slot.slot_id && x.status === 'ใช้งาน' && x.change_type !== 'สอนแทน'; },
        { status: 'ยกเลิก' }, c, 'แทนที่การเปลี่ยนแปลงเดิม');
      return Db.insert('DailyChanges', rec, c);
    });
  }

  function cancelChange(ctx, payload) {
    if (!payload.reason) throw new AppError('VALIDATION', 'กรุณาระบุเหตุผล');
    return Db.withLock(function () {
      var ch = Db.get('DailyChanges', payload.change_id);
      if (!ch) throw new AppError('NOT_FOUND', 'ไม่พบรายการ');
      if (ch.change_type === 'สอนแทน') throw new AppError('VALIDATION', 'ยกเลิกการสอนแทนจากหน้าจัดสอนแทน');
      return Db.update('DailyChanges', ch.change_id, { status: 'ยกเลิก' }, { user: ctx.user, reason: payload.reason });
    });
  }

  return { get: get, saveChange: saveChange, cancelChange: cancelChange };
})();
