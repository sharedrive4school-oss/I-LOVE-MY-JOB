/**
 * Validation.gs — ตรวจตารางเรียนทั้งตาราง (Validation Engine ระดับคาบ)
 *
 * ใช้ทุกครั้งก่อนบันทึกและก่อนเผยแพร่ (ข้อ 22–24) — เป็นฟังก์ชันบริสุทธิ์ ทดสอบในเครื่องได้
 * validateSchedule(data, termId, slots) → { ok, errors[], warnings[] }
 * slot: { day, period, class_id, subject_id, teacher_id, co_teacher_id, req_id, source }
 */

var ScheduleValidator = (function () {
  var DN = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' };

  function validateSchedule(data, termId, slots) {
    var R = Rules;
    var errors = [], warnings = [];
    function at(d, p) { return 'วัน' + (DN[d] || d) + ' คาบ ' + p; }
    function err(rule, msg, ref) { errors.push({ rule: rule, level: 'ผิด', message: msg, ref: ref || '' }); }
    function warn(rule, msg, ref) { warnings.push({ rule: rule, level: 'เตือน', message: msg, ref: ref || '' }); }

    var teachers = {}; (data.teachers || []).forEach(function (t) { teachers[t.teacher_id] = t; });
    var subjects = {}; (data.subjects || []).forEach(function (s) { subjects[s.subject_id] = s; });
    var classes = {}; (data.classes || []).forEach(function (c) { classes[c.class_id] = c; });
    var reqs = {}; (data.requirements || []).forEach(function (r) { if (r.term_id === termId) reqs[r.req_id] = r; });
    function tn(id) { return teachers[id] ? teachers[id].name : id; }
    function cn(id) { return classes[id] ? classes[id].name : id; }
    function sn(id) { return subjects[id] ? subjects[id].name : id; }

    var term = R.byKey(data.terms || [], 'term_id', termId);
    if (!term) { err('V09', 'ไม่พบภาคเรียน ' + termId); return { ok: false, errors: errors, warnings: warnings }; }
    var days = R.schoolDays(data), tp = R.teachingPeriods(data, termId);
    var morning = R.parseNumList((R.byKey(data.settings || [], 'key', 'morning_periods') || {}).value || '1-3') || [];
    var locks = (data.locks || []).filter(function (l) { return l.term_id === termId && l.status === 'ใช้งาน'; });

    // V09/V10 ข้อมูลแต่ละคาบ
    slots.forEach(function (s) {
      var where = at(s.day, s.period) + ' — ' + cn(s.class_id);
      if (days.indexOf(Number(s.day)) < 0 || tp.indexOf(Number(s.period)) < 0) err('V10', where + ': ไม่ใช่วัน/คาบเรียน');
      if (!classes[s.class_id]) err('V09', where + ': ไม่พบชั้น');
      if (!subjects[s.subject_id]) err('V09', where + ': ไม่พบวิชา ' + s.subject_id);
      if (s.teacher_id && !teachers[s.teacher_id]) err('V09', where + ': ไม่พบครู ' + s.teacher_id);
      if (s.co_teacher_id && !teachers[s.co_teacher_id]) err('V09', where + ': ไม่พบครูประกบ ' + s.co_teacher_id);
      var r = reqs[s.req_id];
      if (!r) { err('V09', where + ': ไม่ตรงกับโครงสร้างคาบใดของภาคเรียนนี้ (' + (s.req_id || 'ไม่มีรหัส') + ')'); return; }
      if (r.status !== 'ใช้งาน') err('V06', where + ': โครงสร้าง ' + r.req_id + ' ปิดใช้งานแล้ว');
      if (r.class_id !== s.class_id || r.subject_id !== s.subject_id) err('V09', where + ': ชั้น/วิชาไม่ตรงกับโครงสร้าง ' + r.req_id);
      if (!r.group_id) {
        if ((r.teacher_id || '') !== (s.teacher_id || '')) err('V09', where + ': ครูผู้สอนไม่ตรงกับโครงสร้าง (' + tn(r.teacher_id) + ')');
        if ((r.co_teacher_id || '') !== (s.co_teacher_id || '')) err('V03', where + ': ' + sn(s.subject_id) + ' ต้องมีครูประกบ ' + tn(r.co_teacher_id));
        var allowD = R.parseNumList(r.allowed_days), allowP = R.parseNumList(r.allowed_periods);
        if ((allowD && allowD.indexOf(Number(s.day)) < 0) || (allowP && allowP.indexOf(Number(s.period)) < 0))
          err('V10', where + ': ' + sn(s.subject_id) + ' จัดได้เฉพาะวัน ' + (r.allowed_days || 'ทุกวัน') + ' คาบ ' + (r.allowed_periods || 'ทุกคาบ'));
      }
      var sub = subjects[s.subject_id];
      if (sub && sub.semester_only && Number(sub.semester_only) !== Number(term.semester))
        err('V06', where + ': ' + sub.name + ' ใช้เฉพาะภาคเรียนที่ ' + sub.semester_only);
    });

    // V01 ชั้นชน
    var byClassSlot = {};
    slots.forEach(function (s) { var k = s.class_id + '|' + s.day + '|' + s.period; (byClassSlot[k] = byClassSlot[k] || []).push(s); });
    Object.keys(byClassSlot).forEach(function (k) {
      var list = byClassSlot[k];
      if (list.length > 1) err('V01', at(list[0].day, list[0].period) + ' — ' + cn(list[0].class_id) + ' มี ' + list.length + ' รายวิชา (' +
        list.map(function (s) { return sn(s.subject_id); }).join(', ') + ')', list[0].class_id);
    });

    // V02 ครูชน (นับทั้งผู้สอน ผู้ประกบ และครูที่ถูกจองในกิจกรรมล็อก)
    var byTeacherSlot = {};
    function add(t, s, role) { var k = t + '|' + s.day + '|' + s.period; (byTeacherSlot[k] = byTeacherSlot[k] || []).push({ s: s, role: role }); }
    slots.forEach(function (s) {
      if (s.teacher_id) add(s.teacher_id, s, 'สอน');
      if (s.co_teacher_id) add(s.co_teacher_id, s, 'ประกบ');
    });
    locks.forEach(function (l) {
      R.splitIds(l.teacher_ids).forEach(function (t) { add(t, { day: Number(l.day), period: Number(l.period), class_id: 'กิจกรรม', subject_id: l.subject_id, lock: true }, 'กิจกรรม'); });
    });
    Object.keys(byTeacherSlot).forEach(function (k) {
      var list = byTeacherSlot[k];
      if (list.length < 2) return;
      var t = k.split('|')[0];
      var what = list.map(function (x) { return x.s.lock ? sn(x.s.subject_id) : cn(x.s.class_id) + (x.role === 'ประกบ' ? ' (ประกบ)' : ''); });
      err(list.some(function (x) { return x.role === 'ประกบ'; }) ? 'V03' : 'V02',
        at(list[0].s.day, list[0].s.period) + ' — ' + tn(t) + ' ถูกจัดให้สอน ' + what.join(' และ ') + ' พร้อมกัน', t);
    });

    // V04 ครูไม่ว่างประจำ
    var blockCache = {};
    slots.forEach(function (s) {
      [s.teacher_id, s.co_teacher_id].forEach(function (t) {
        if (!t) return;
        blockCache[t] = blockCache[t] || R.blockedSlots(data, termId, t);
        if (blockCache[t][R.slotKey(s.day, s.period)]) err('V04', at(s.day, s.period) + ' — ' + tn(t) + ' ไม่ว่างในช่วงนี้ แต่ถูกจัดสอน ' + cn(s.class_id), t);
      });
    });

    // V05 กิจกรรมล็อกเวลา: ต้องอยู่ตรงเวลา และช่องล็อกต้องไม่มีวิชาอื่น
    locks.forEach(function (l) {
      R.splitIds(l.class_ids).forEach(function (c) {
        var here = byClassSlot[c + '|' + l.day + '|' + l.period] || [];
        if (!here.some(function (s) { return s.subject_id === l.subject_id; }))
          err('V05', at(l.day, l.period) + ' — ' + cn(c) + ' ต้องเป็น ' + sn(l.subject_id) + (here.length ? ' แต่พบ ' + sn(here[0].subject_id) : ' แต่ยังว่าง'), l.lock_id);
      });
    });
    slots.forEach(function (s) {
      var r = reqs[s.req_id];
      if (r && r.group_id) {
        var ok = locks.some(function (l) { return l.group_id === r.group_id && Number(l.day) === Number(s.day) && Number(l.period) === Number(s.period) && R.splitIds(l.class_ids).indexOf(s.class_id) >= 0; });
        if (!ok) err('V05', at(s.day, s.period) + ' — ' + cn(s.class_id) + ': ' + sn(s.subject_id) + ' ต้องอยู่ตามเวลาที่ล็อกไว้เท่านั้น');
      }
    });

    // V06 จำนวนคาบตามโครงสร้าง / V07–V08 รวมต่อชั้น
    var countReq = {};
    slots.forEach(function (s) { countReq[s.req_id] = (countReq[s.req_id] || 0) + 1; });
    Object.keys(reqs).forEach(function (id) {
      var r = reqs[id];
      if (r.status !== 'ใช้งาน') return;
      var n = countReq[id] || 0;
      if (n !== Number(r.periods)) err('V06', cn(r.class_id) + ' ' + sn(r.subject_id) + (r.teacher_id ? ' (' + tn(r.teacher_id) + ')' : '') +
        ': ต้องมี ' + r.periods + ' คาบ แต่จัดไว้ ' + n + ' คาบ', id);
    });
    var cap = days.length * tp.length;
    R.periodSummary(data, termId).forEach(function (c) {
      var n = slots.filter(function (s) { return s.class_id === c.class_id; }).length;
      if (n > cap) err('V07', c.name + ': จัดไว้ ' + n + ' คาบ เกิน ' + cap + ' คาบ', c.class_id);
      else if (n < cap) warn('V08', c.name + ' — ' + n + '/' + cap + ' คาบ — ว่าง ' + (cap - n) + ' คาบ', c.class_id);
    });

    // V12 ครูวิชาหลักสอนช่วงเช้าเกินที่กำหนด (เตือน)
    var capV = (R.byKey(data.settings || [], 'key', 'core_teacher_max_morning_per_day') || { value: '2' }).value;
    if (String(capV).trim() !== '' && capV !== 'ไม่จำกัด') {
      var coreT = {}, mc = {};
      Object.keys(reqs).forEach(function (id) { var r = reqs[id]; if (r.teacher_id && subjects[r.subject_id] && subjects[r.subject_id].is_core) coreT[r.teacher_id] = true; });
      slots.forEach(function (s) {
        if (morning.indexOf(Number(s.period)) < 0) return;
        [s.teacher_id, s.co_teacher_id].forEach(function (t) { if (t && coreT[t]) { var k = t + '|' + s.day; mc[k] = (mc[k] || 0) + 1; } });
      });
      Object.keys(mc).forEach(function (k) {
        if (mc[k] > Number(capV)) { var p = k.split('|'); warn('V12', tn(p[0]) + ' วัน' + DN[p[1]] + ': สอนช่วงเช้า ' + mc[k] + ' คาบ (กำหนดไม่เกิน ' + capV + ')', p[0]); }
      });
    }

    // V11 กฎพึงประสงค์ (เตือนเท่านั้น) — ใช้เมื่อเปิด "วิชาหลักควรอยู่ช่วงเช้า"
    var corePrefV = (R.byKey(data.settings || [], 'key', 'core_morning_preference') || { value: 'ไม่ใช้' }).value === 'ใช้';
    var coreAfter = {};
    slots.forEach(function (s) {
      var sub = subjects[s.subject_id];
      if (corePrefV && sub && sub.is_core && morning.indexOf(Number(s.period)) < 0) coreAfter[s.class_id] = (coreAfter[s.class_id] || 0) + 1;
    });
    Object.keys(coreAfter).sort().forEach(function (c) { warn('V11', cn(c) + ': วิชาหลักอยู่ช่วงบ่าย ' + coreAfter[c] + ' คาบ', c); });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /** ข้อความสรุปแบบข้อ 23–24 */
  function summarize(res) {
    if (res.ok) return '✅ ไม่พบความขัดแย้ง';
    return '❌ พบความขัดแย้ง ' + res.errors.length + ' รายการ\n' +
      res.errors.map(function (e, i) { return (i + 1) + '. ' + e.message; }).join('\n');
  }

  /** สลับสองคาบของชั้นเดียวกัน (คืนชุดใหม่ ไม่แก้ของเดิม) */
  function applySwap(slots, classId, a, b) {
    var out = slots.map(function (s) { var c = {}; for (var k in s) c[k] = s[k]; return c; });
    var sa = out.filter(function (s) { return s.class_id === classId && Number(s.day) === Number(a.day) && Number(s.period) === Number(a.period); })[0];
    var sb = out.filter(function (s) { return s.class_id === classId && Number(s.day) === Number(b.day) && Number(s.period) === Number(b.period); })[0];
    if (!sa) throw new Error('ไม่พบคาบต้นทาง');
    if (sb) { sb.day = Number(a.day); sb.period = Number(a.period); sb.source = 'แก้มือ'; }
    sa.day = Number(b.day); sa.period = Number(b.period); sa.source = 'แก้มือ';
    return out;
  }

  /**
   * ช่องที่สลับกับคาบที่เลือกได้โดยไม่เกิดความขัดแย้ง (สำหรับหน้าแก้ตาราง)
   * คืน [{ day, period, ok, reasons[] }] — ok=false พร้อมเหตุผล ให้ Admin เห็นว่าทำไมสลับไม่ได้
   */
  function swapOptions(data, termId, slots, classId, day, period) {
    var base = validateSchedule(data, termId, slots);
    var baseKeys = {};
    base.errors.forEach(function (e) { baseKeys[e.message] = true; });
    var days = Rules.schoolDays(data), tp = Rules.teachingPeriods(data, termId);
    var out = [];
    days.forEach(function (d) {
      tp.forEach(function (p) {
        if (d === Number(day) && p === Number(period)) return;
        var trial = applySwap(slots, classId, { day: day, period: period }, { day: d, period: p });
        var res = validateSchedule(data, termId, trial);
        var fresh = res.errors.filter(function (e) { return !baseKeys[e.message]; });
        out.push({ day: d, period: p, ok: fresh.length === 0, reasons: fresh.map(function (e) { return e.message; }) });
      });
    });
    return out;
  }

  return { validateSchedule: validateSchedule, summarize: summarize, applySwap: applySwap, swapOptions: swapOptions };
})();
