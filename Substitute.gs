/**
 * Substitute.gs — ระบบจัดสอนแทน (Phase 9, ข้อ 29–30)
 *
 * - ระบบ "เสนอ" รายชื่อ Admin เป็นผู้ "ยืนยัน" — ไม่มีการมอบหมายอัตโนมัติ
 * - เงื่อนไขบังคับ: ว่างคาบนั้น, ไม่สอนห้องอื่น/ไม่ประกบ/ไม่ติดกิจกรรมรวม, ไม่ลา/อบรม/ราชการ/ภารกิจ,
 *   ไม่ติดเวลาไม่ว่างประจำ, สถานะใช้งาน, ประเภทครูตามค่า substitute_teacher_types
 * - จัดอันดับเฉพาะครูที่ผ่านเงื่อนไขบังคับ: ครูประกบของคาบนั้น → สอนวิชานี้ได้ → สอนแทนน้อยครั้ง → คาบสอนวันนั้นน้อย
 *   (จำนวนครั้งที่สอนแทนใช้จัดอันดับเท่านั้น ไม่ทำให้ครูที่ไม่ผ่านเงื่อนไขถูกเสนอ)
 */

var SubRules = (function () {

  /** จำนวนครั้งที่ครูแต่ละคนสอนแทนในภาคเรียน */
  function counts(substitutions, termId) {
    var m = {};
    (substitutions || []).filter(function (u) { return u.status === 'ยืนยันแล้ว' && (!termId || u.term_id === termId); })
      .forEach(function (u) { m[u.substitute_teacher_id] = (m[u.substitute_teacher_id] || 0) + 1; });
    return m;
  }

  /**
   * รายชื่อผู้สอนแทนสำหรับคาบหนึ่ง
   * day = ผลจาก DailyRules.build, extra = ข้อมูลประกอบ (absences, substitutions, locks)
   * คืน { slot, role, absent_teacher_id, candidates:[...ผ่าน], excluded:[...ไม่ผ่าน + เหตุผล] }
   */
  function candidates(data, day, extra, slotId, role) {
    var R = Rules;
    var cls = null, row = null;
    day.classes.forEach(function (c) { c.slots.forEach(function (s) { if (s.slot_id === slotId) { cls = c; row = s; } }); });
    if (!row) throw new Error('ไม่พบคาบนี้ในตารางของวันที่ ' + day.date);
    if (role !== 'ผู้สอน' && role !== 'ผู้ประกบ') throw new Error('บทบาทต้องเป็น ผู้สอน หรือ ผู้ประกบ');
    var absentId = role === 'ผู้สอน' ? (row.original_teacher_id || row.teacher_id) : (row.original_co_teacher_id || row.co_teacher_id);
    if (!absentId) throw new Error('คาบนี้ไม่มี' + role);
    var p = row.period;
    var absences = (extra.absences || []).filter(function (a) { return a.date === day.date && a.status === 'ใช้งาน'; });
    function isAbsent(t) { return absences.some(function (a) { return a.teacher_id === t && DailyRules.absenceCovers(a, p); }); }
    if (!isAbsent(absentId)) throw new Error('ครูของคาบนี้ไม่ได้ถูกบันทึกว่าไม่อยู่ — บันทึกครูไม่อยู่ก่อน');

    var allowedTypes = R.splitIds((R.byKey(data.settings || [], 'key', 'substitute_teacher_types') || {}).value || 'ครูประจำ');
    var subjectsOf = {};
    (data.teacherSubjects || []).forEach(function (x) { (subjectsOf[x.teacher_id] = subjectsOf[x.teacher_id] || {})[x.subject_id] = true; });
    var subCount = counts(extra.substitutions, day.term_id);

    // ใครใช้เวลาคาบนี้อยู่แล้ว (ตารางรายวันจริง หลังการเปลี่ยนแปลงและการสอนแทน)
    var busy = {}, dayLoad = {};
    day.classes.forEach(function (c) {
      c.slots.forEach(function (s) {
        if (s.status === 'ยกเลิก') return;
        [s.teacher_id, s.co_teacher_id].forEach(function (t) {
          if (!t || isAbsentAt(t, s.period)) return;
          dayLoad[t] = (dayLoad[t] || 0) + 1;
          if (s.period === p) busy[t] = c.name + (t === s.co_teacher_id ? ' (ประกบ)' : '');
        });
      });
    });
    function isAbsentAt(t, per) { return absences.some(function (a) { return a.teacher_id === t && DailyRules.absenceCovers(a, per); }); }
    (extra.locks || []).filter(function (l) { return Number(l.day) === day.day && Number(l.period) === p; }).forEach(function (l) {
      R.splitIds(l.teacher_ids).forEach(function (t) { busy[t] = 'กิจกรรมรวม'; });
    });

    var ok = [], excluded = [];
    (data.teachers || []).forEach(function (t) {
      var id = t.teacher_id, reasons = [];
      if (id === absentId) return;
      var isOwnCo = role === 'ผู้สอน' && row.co_teacher_id === id;   // ครูประกบของคาบนี้อยู่ในห้องอยู่แล้ว
      if (role === 'ผู้ประกบ' && row.teacher_id === id) return;
      if (t.status !== 'ใช้งาน') reasons.push('ปิดใช้งาน');
      if (allowedTypes.indexOf(t.type) < 0) reasons.push('ประเภท ' + t.type + ' ไม่อยู่ในรายชื่อผู้สอนแทน');
      if (isAbsent(id)) reasons.push('ไม่อยู่ (' + absences.filter(function (a) { return a.teacher_id === id; })[0].type + ')');
      if (busy[id] && !isOwnCo) reasons.push('สอน ' + busy[id]);
      if (R.blockedSlots(data, day.term_id, id)[R.slotKey(day.day, p)]) reasons.push('ไม่ว่างประจำในช่วงนี้');
      var info = { teacher_id: id, name: t.name, short_name: t.short_name, sub_count: subCount[id] || 0, periods_today: dayLoad[id] || 0,
        can_teach_subject: !!(subjectsOf[id] && subjectsOf[id][row.subject_id]), is_slot_co_teacher: isOwnCo };
      if (reasons.length) { info.reasons = reasons; excluded.push(info); return; }
      info.label = t.name + ' — ' + (isOwnCo ? 'ครูประกบของคาบนี้' : 'ว่าง') + ' / สอนแทน ' + info.sub_count + ' ครั้ง' +
        (info.can_teach_subject ? ' / สอนวิชานี้ได้' : '') + ' / วันนี้สอน ' + info.periods_today + ' คาบ';
      ok.push(info);
    });
    ok.sort(function (a, b) {
      return (b.is_slot_co_teacher - a.is_slot_co_teacher) || (b.can_teach_subject - a.can_teach_subject) ||
        (a.sub_count - b.sub_count) || (a.periods_today - b.periods_today) || (a.teacher_id < b.teacher_id ? -1 : 1);
    });
    ok.forEach(function (x, i) { x.rank = i + 1; });
    return {
      date: day.date, slot_id: slotId, class_id: cls.class_id, class_name: cls.name, period: p, subject_id: row.subject_id, subject: row.subject,
      role: role, absent_teacher_id: absentId, candidates: ok, excluded: excluded
    };
  }

  /** รายงานภาระสอนแทน (ข้อ 30) */
  function report(data, substitutions, masterRows, termId) {
    var teachers = {}; (data.teachers || []).forEach(function (t) { teachers[t.teacher_id] = t; });
    var classes = {}; (data.classes || []).forEach(function (c) { classes[c.class_id] = c; });
    var subjects = {}; (data.subjects || []).forEach(function (s) { subjects[s.subject_id] = s; });
    var slots = {}; (masterRows || []).forEach(function (m) { slots[m.slot_id] = m; });
    var by = {};
    (substitutions || []).filter(function (u) { return u.status === 'ยืนยันแล้ว' && (!termId || u.term_id === termId); }).forEach(function (u) {
      var s = slots[u.slot_id] || {};
      var r = by[u.substitute_teacher_id] = by[u.substitute_teacher_id] || { teacher_id: u.substitute_teacher_id,
        name: teachers[u.substitute_teacher_id] ? teachers[u.substitute_teacher_id].name : u.substitute_teacher_id, count: 0, items: [] };
      r.count++;
      r.items.push({ date: u.date, period: s.period, replaced: teachers[u.original_teacher_id] ? teachers[u.original_teacher_id].name : u.original_teacher_id,
        class_name: classes[s.class_id] ? classes[s.class_id].name : s.class_id, subject: subjects[s.subject_id] ? subjects[s.subject_id].name : s.subject_id, role: u.role });
    });
    var out = (data.teachers || []).filter(function (t) { return t.status === 'ใช้งาน'; }).map(function (t) {
      return by[t.teacher_id] || { teacher_id: t.teacher_id, name: t.name, count: 0, items: [] };
    });
    out.forEach(function (r) { r.items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.period || 0) - (b.period || 0); }); });
    return out.sort(function (a, b) { return b.count - a.count || (a.teacher_id < b.teacher_id ? -1 : 1); });
  }

  return { candidates: candidates, counts: counts, report: report };
})();

/** ส่วนที่ใช้ Google Sheets */
var Substitute = (function () {

  function context(isoDate) {
    var data = Db.loadData();
    var info = Rules.describeDate(data, isoDate);
    if (!info.term_id || !info.is_school_day) throw new AppError('VALIDATION', 'วันที่ ' + isoDate + ' ไม่ใช่วันเรียน');
    var v = Master.versionForDate(info.term_id, isoDate);
    if (!v) throw new AppError('NOT_FOUND', 'ยังไม่มีตารางที่เผยแพร่สำหรับวันที่นี้');
    var m = Master.get(info.term_id, { version: v });
    var extra = { version: v, masterSlots: m.slots, locks: m.locks, changes: Db.all('DailyChanges'), absences: Db.all('Absences'), substitutions: Db.all('Substitutions') };
    return { data: data, info: info, extra: extra, day: DailyRules.build(data, isoDate, extra) };
  }

  /** รายการคาบที่รอจัดสอนแทนของวันที่ */
  function pending(isoDate) {
    var c = context(isoDate);
    var out = [];
    c.day.classes.forEach(function (cl) {
      cl.slots.forEach(function (s) {
        if (s.status !== 'รอจัดสอนแทน') return;
        var abs = c.extra.absences.filter(function (a) { return a.date === isoDate && a.status === 'ใช้งาน' && DailyRules.absenceCovers(a, s.period); });
        [['ผู้สอน', s.teacher_id], ['ผู้ประกบ', s.co_teacher_id]].forEach(function (r) {
          if (!r[1] || !abs.some(function (a) { return a.teacher_id === r[1]; })) return;
          var hasSub = c.extra.substitutions.some(function (u) { return u.date === isoDate && u.slot_id === s.slot_id && u.role === r[0] && u.status === 'ยืนยันแล้ว'; });
          if (!hasSub) out.push({ slot_id: s.slot_id, class_id: cl.class_id, class_name: cl.name, period: s.period, subject: s.subject, role: r[0], absent_teacher_id: r[1] });
        });
      });
    });
    return { date: isoDate, day_name: c.day.day_name, pending: out };
  }

  function suggest(payload) {
    var c = context(String(payload.date || ''));
    try { return SubRules.candidates(c.data, c.day, c.extra, payload.slot_id, payload.role || 'ผู้สอน'); }
    catch (e) { throw new AppError('VALIDATION', e.message); }
  }

  /** Admin ยืนยันผู้สอนแทน — ตรวจซ้ำกับข้อมูลล่าสุดก่อนบันทึก */
  function confirm(ctx, payload) {
    var isoDate = String(payload.date || ''), role = payload.role || 'ผู้สอน';
    var cc = { user: ctx.user, reason: payload.reason || 'ยืนยันผู้สอนแทน' };
    return Db.withLock(function () {
      var c = context(isoDate);
      var res;
      try { res = SubRules.candidates(c.data, c.day, c.extra, payload.slot_id, role); }
      catch (e) { throw new AppError('VALIDATION', e.message); }
      var pick = res.candidates.filter(function (x) { return x.teacher_id === payload.substitute_teacher_id; })[0];
      if (!pick) {
        var ex = res.excluded.filter(function (x) { return x.teacher_id === payload.substitute_teacher_id; })[0];
        throw new AppError('CONFLICT', 'ไม่สามารถจัดครูคนนี้สอนแทนได้' + (ex ? ': ' + ex.reasons.join(', ') : ''));
      }
      var dup = c.extra.substitutions.some(function (u) { return u.date === isoDate && u.slot_id === payload.slot_id && u.role === role && u.status === 'ยืนยันแล้ว'; });
      if (dup) throw new AppError('CONFLICT', 'คาบนี้มีผู้สอนแทนแล้ว — ยกเลิกรายการเดิมก่อน');
      var absence = c.extra.absences.filter(function (a) {
        return a.date === isoDate && a.status === 'ใช้งาน' && a.teacher_id === res.absent_teacher_id && DailyRules.absenceCovers(a, res.period);
      })[0];
      var now = Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd HH:mm:ss');
      var sub = {
        absence_id: absence.absence_id, date: isoDate, term_id: c.info.term_id, slot_id: payload.slot_id,
        original_teacher_id: res.absent_teacher_id, substitute_teacher_id: pick.teacher_id, role: role,
        status: 'ยืนยันแล้ว', confirmed_by: ctx.user, confirmed_at: now
      };
      // ตรวจตารางทั้งวันหลังเพิ่มรายการนี้
      var trial = {}; for (var k in c.extra) trial[k] = c.extra[k];
      trial.substitutions = c.extra.substitutions.concat([Object.assign({ sub_id: 'NEW' }, sub)]);
      var check = DailyRules.validateDay(c.data, DailyRules.build(c.data, isoDate, trial), trial);
      if (!check.ok) throw new AppError('CONFLICT', 'ไม่สามารถบันทึกได้\n' + check.errors.map(function (e, i) { return (i + 1) + '. ' + e.message; }).join('\n'), check.errors);
      var saved = Db.insert('Substitutions', sub, cc);
      Db.insert('DailyChanges', {
        date: isoDate, term_id: c.info.term_id, slot_id: payload.slot_id, change_type: 'สอนแทน', new_teacher_id: pick.teacher_id,
        new_subject_id: '', sub_id: saved.sub_id, note: role + ' แทน ' + (Rules.byKey(c.data.teachers, 'teacher_id', res.absent_teacher_id) || {}).name,
        status: 'ใช้งาน', created_by: ctx.user, created_at: now
      }, cc);
      return { sub: saved, label: pick.label };
    });
  }

  function cancel(ctx, payload) {
    if (!payload.reason) throw new AppError('VALIDATION', 'กรุณาระบุเหตุผล');
    var cc = { user: ctx.user, reason: payload.reason };
    return Db.withLock(function () {
      var u = Db.get('Substitutions', payload.sub_id);
      if (!u || u.status !== 'ยืนยันแล้ว') throw new AppError('NOT_FOUND', 'ไม่พบรายการสอนแทนที่ใช้งานอยู่');
      Db.update('Substitutions', u.sub_id, { status: 'ยกเลิก' }, cc);
      Db.updateWhere('DailyChanges', function (x) { return x.sub_id === u.sub_id && x.status === 'ใช้งาน'; }, { status: 'ยกเลิก' }, cc, 'ยกเลิกการสอนแทน');
      return { sub_id: u.sub_id, status: 'ยกเลิก' };
    });
  }

  function report(termId) {
    requireTerm_(termId);
    return SubRules.report(Db.loadData(), Db.all('Substitutions'), Db.all('Master'), termId);
  }

  return { pending: pending, suggest: suggest, confirm: confirm, cancel: cancel, report: report };
})();
