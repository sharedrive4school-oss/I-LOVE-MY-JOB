/**
 * Rules.gs — กฎทางธุรกิจแบบ "ฟังก์ชันบริสุทธิ์" (ไม่เรียก Google API)
 *
 * รับข้อมูลเป็น object { settings, terms, classes, periods, teachers, subjects,
 *   teacherSubjects, requirements, locks, blocks } แล้วคืนผลลัพธ์
 * จึงทดสอบได้ทั้งใน Apps Script และในเครื่อง (Node.js) — ดู tests/
 */

var Rules = (function () {

  // ---------- เครื่องมือทั่วไป ----------

  function byKey(list, key, value) {
    for (var i = 0; i < list.length; i++) if (list[i][key] === value) return list[i];
    return null;
  }

  /** "1-3,5" → [1,2,3,5]; ค่าว่าง → null (= ไม่จำกัด) */
  function parseNumList(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (s === '') return null;
    var out = [];
    s.split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = Number(m[1]), b = Number(m[2]);
        if (a > b) throw new Error('ช่วงตัวเลขไม่ถูกต้อง: ' + part);
        for (var n = a; n <= b; n++) out.push(n);
      } else if (/^\d+$/.test(part)) {
        out.push(Number(part));
      } else {
        throw new Error('รูปแบบไม่ถูกต้อง: "' + part + '" (ใช้เช่น 1-3 หรือ 1,3,5)');
      }
    });
    return out.filter(function (v, i) { return out.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }

  function splitIds(s) {
    if (!s) return [];
    return String(s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /** รหัสถัดไป เช่น nextId('T', ['T01','T09'], 2) → 'T10' */
  function nextId(prefix, ids, width) {
    var max = 0;
    var re = new RegExp('^' + prefix + '(\\d+)$');
    ids.forEach(function (id) {
      var m = String(id || '').match(re);
      if (m) max = Math.max(max, Number(m[1]));
    });
    var n = String(max + 1);
    while (n.length < (width || 3)) n = '0' + n;
    return prefix + n;
  }

  function settingValue(data, key, fallback) {
    var s = byKey(data.settings || [], 'key', key);
    return s && s.value !== '' ? s.value : fallback;
  }

  function slotKey(day, period) { return day + '-' + period; }

  // ---------- ภาคเรียน / วันที่ ----------

  function teachingPeriods(data, termId) {
    return (data.periods || [])
      .filter(function (p) { return p.term_id === termId && p.type === 'คาบเรียน'; })
      .map(function (p) { return Number(p.period_no); })
      .sort(function (a, b) { return a - b; });
  }

  function schoolDays(data) {
    var n = Number(settingValue(data, 'days_per_week', 5));
    var d = [];
    for (var i = 1; i <= n; i++) d.push(i);
    return d;
  }

  function weeklyCapacity(data, termId) {
    return schoolDays(data).length * teachingPeriods(data, termId).length;
  }

  function isIsoDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  /** วันในสัปดาห์ 1 = จันทร์ … 7 = อาทิตย์ (ไม่ขึ้นกับเขตเวลา) */
  function dayOfWeek(isoDate) {
    var js = new Date(isoDate + 'T00:00:00Z').getUTCDay();
    return js === 0 ? 7 : js;
  }

  /** หาภาคเรียนจากวันที่ — คืน null ถ้าไม่อยู่ในภาคเรียนใด (หรือยังไม่ได้กรอกวันเปิด-ปิดภาค) */
  function termForDate(terms, isoDate) {
    var hits = (terms || []).filter(function (t) {
      return t.start_date && t.end_date && t.start_date <= isoDate && isoDate <= t.end_date;
    });
    return hits.length ? hits[0] : null;
  }

  /** สรุปข้อมูลของวันที่: ภาคเรียน วัน และเป็นวันเรียนหรือไม่ */
  function describeDate(data, isoDate) {
    if (!isIsoDate(isoDate)) throw new Error('วันที่ไม่ถูกต้อง: ' + isoDate);
    var dow = dayOfWeek(isoDate);
    var term = termForDate(data.terms, isoDate);
    var cal = byKey(data.calendar || [], 'date', isoDate);
    var inWeek = schoolDays(data).indexOf(dow) >= 0;
    var isSchoolDay, dayType, reason;
    if (!term) { isSchoolDay = false; dayType = 'ปิดภาคเรียน'; reason = 'ไม่อยู่ในช่วงภาคเรียนใด (หรือยังไม่ได้กรอกวันเปิด-ปิดภาค)'; }
    else if (cal) { isSchoolDay = cal.is_school_day === true; dayType = cal.day_type; reason = cal.note || ''; }
    else if (!inWeek) { isSchoolDay = false; dayType = 'วันหยุด'; reason = 'วัน' + DAY_NAMES_SAFE[dow]; }
    else { isSchoolDay = true; dayType = 'วันเรียนปกติ'; reason = ''; }
    return {
      date: isoDate, day: dow, day_name: DAY_NAMES_SAFE[dow],
      term_id: term ? term.term_id : null, year: term ? term.year : null, semester: term ? term.semester : null,
      is_school_day: isSchoolDay, day_type: dayType, note: reason
    };
  }
  var DAY_NAMES_SAFE = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' };

  // ---------- โครงสร้างคาบ ----------

  function activeReqs(data, termId) {
    return (data.requirements || []).filter(function (r) { return r.term_id === termId && r.status === 'ใช้งาน'; });
  }

  function timetableClasses(data) {
    return (data.classes || [])
      .filter(function (c) { return c.status === 'ใช้งาน' && c.in_timetable === true; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }

  /** สรุปจำนวนคาบต่อชั้น เช่น "ป.2 — 29/30 คาบ — ขาด 1 คาบ" (ข้อ 14) */
  function periodSummary(data, termId) {
    var cap = weeklyCapacity(data, termId);
    var reqs = activeReqs(data, termId);
    return timetableClasses(data).map(function (c) {
      var mine = reqs.filter(function (r) { return r.class_id === c.class_id; });
      var total = mine.reduce(function (s, r) { return s + (Number(r.periods) || 0); }, 0);
      var diff = total - cap;
      var status = diff === 0 ? 'ครบ' : (diff < 0 ? 'ขาด ' + (-diff) + ' คาบ' : 'เกิน ' + diff + ' คาบ');
      return {
        class_id: c.class_id, name: c.name, total: total, capacity: cap, diff: diff, status: status,
        label: c.name + ' — ' + total + '/' + cap + ' คาบ' + (diff === 0 ? '' : ' — ' + status)
      };
    });
  }

  /** ภาระสอนต่อครู (สอน + ประกบ + กิจกรรมรวม) */
  function teacherLoads(data, termId) {
    var map = {};
    (data.teachers || []).forEach(function (t) {
      map[t.teacher_id] = { teacher_id: t.teacher_id, name: t.short_name || t.name, teach: 0, co: 0, activity: 0, total: 0 };
    });
    activeReqs(data, termId).forEach(function (r) {
      if (r.teacher_id && map[r.teacher_id]) map[r.teacher_id].teach += Number(r.periods) || 0;
      if (r.co_teacher_id && map[r.co_teacher_id]) map[r.co_teacher_id].co += Number(r.periods) || 0;
    });
    (data.locks || []).filter(function (l) { return l.term_id === termId && l.status === 'ใช้งาน'; }).forEach(function (l) {
      splitIds(l.teacher_ids).forEach(function (t) { if (map[t]) map[t].activity += 1; });
    });
    return Object.keys(map).map(function (k) {
      var m = map[k]; m.total = m.teach + m.co + m.activity; return m;
    }).filter(function (m) { return m.total > 0; })
      .sort(function (a, b) { return b.total - a.total || (a.teacher_id < b.teacher_id ? -1 : 1); });
  }

  /** ช่องเวลาที่ครูไม่ว่างประจำ: Set ของ "วัน-คาบ" */
  function blockedSlots(data, termId, teacherId) {
    var periods = teachingPeriods(data, termId);
    var set = {};
    (data.blocks || []).filter(function (b) { return b.term_id === termId && b.teacher_id === teacherId; }).forEach(function (b) {
      var from = b.period_from === null || b.period_from === '' ? periods[0] : Number(b.period_from);
      var to = b.period_to === null || b.period_to === '' ? periods[periods.length - 1] : Number(b.period_to);
      periods.forEach(function (p) { if (p >= from && p <= to) set[slotKey(Number(b.day), p)] = true; });
    });
    return set;
  }

  function activeLocks(data, termId) {
    return (data.locks || []).filter(function (l) { return l.term_id === termId && l.status === 'ใช้งาน'; });
  }

  /** ช่องที่โครงสร้างคาบหนึ่งแถวจัดลงได้ (ก่อนพิจารณาวิชาอื่น) */
  function allowedSlots(data, termId, req) {
    var days = parseNumList(req.allowed_days) || schoolDays(data);
    var tp = teachingPeriods(data, termId);
    var periods = (parseNumList(req.allowed_periods) || tp).filter(function (p) { return tp.indexOf(p) >= 0; });
    var locks = activeLocks(data, termId);
    var lockedForClass = {};
    locks.forEach(function (l) {
      if (splitIds(l.class_ids).indexOf(req.class_id) >= 0) lockedForClass[slotKey(l.day, l.period)] = l;
    });
    var bt = req.teacher_id ? blockedSlots(data, termId, req.teacher_id) : {};
    var bc = req.co_teacher_id ? blockedSlots(data, termId, req.co_teacher_id) : {};
    var out = [];
    days.forEach(function (d) {
      periods.forEach(function (p) {
        var k = slotKey(d, p);
        if (req.group_id) {
          var l = lockedForClass[k];
          if (l && l.group_id === req.group_id) out.push(k);
          return;
        }
        if (lockedForClass[k] || bt[k] || bc[k]) return;
        out.push(k);
      });
    });
    return out;
  }

  // ---------- ตรวจข้อมูลก่อนจัดตาราง (ข้อ 57) ----------

  /**
   * คืน { ok, errors:[], warnings:[] } — ok = false ห้ามสร้างตาราง Final
   * แต่ละรายการ: { rule, level:'ผิด'|'เตือน', message, ref }
   */
  function preScheduleChecks(data, termId) {
    var errors = [], warnings = [];
    function err(rule, msg, ref) { errors.push({ rule: rule, level: 'ผิด', message: msg, ref: ref || '' }); }
    function warn(rule, msg, ref) { warnings.push({ rule: rule, level: 'เตือน', message: msg, ref: ref || '' }); }

    var term = byKey(data.terms || [], 'term_id', termId);
    if (!term) { err('P01', 'ไม่พบภาคเรียน ' + termId); return { ok: false, errors: errors, warnings: warnings }; }
    var termName = term.semester + '/' + term.year;
    if (!term.start_date || !term.end_date) warn('P02', 'ภาคเรียน ' + termName + ' ยังไม่ได้กรอกวันเปิด-ปิดภาค ระบบจะหาภาคเรียนจากวันที่ไม่ได้', termId);
    else if (!isIsoDate(term.start_date) || !isIsoDate(term.end_date) || term.start_date > term.end_date) err('P02', 'วันเปิด-ปิดภาคของ ' + termName + ' ไม่ถูกต้อง', termId);

    // P03 เวลาเรียน
    var tp = teachingPeriods(data, termId);
    if (!tp.length) err('P03', 'ภาคเรียน ' + termName + ' ยังไม่มีเวลาเรียน', termId);
    (data.periods || []).filter(function (p) { return p.term_id === termId; }).forEach(function (p) {
      if (!/^\d{2}:\d{2}$/.test(p.start_time) || !/^\d{2}:\d{2}$/.test(p.end_time) || p.start_time >= p.end_time)
        err('P03', 'เวลาเรียน ' + (p.label || p.period_id) + ' ไม่ถูกต้อง (' + p.start_time + '–' + p.end_time + ')', p.period_id);
    });

    // P01 ระดับชั้น
    var classes = timetableClasses(data);
    if (!classes.length) err('P01', 'ไม่มีระดับชั้นที่อยู่ในตารางสอน');

    var teachers = {}; (data.teachers || []).forEach(function (t) { teachers[t.teacher_id] = t; });
    var subjects = {}; (data.subjects || []).forEach(function (s) { subjects[s.subject_id] = s; });
    var classMap = {}; (data.classes || []).forEach(function (c) { classMap[c.class_id] = c; });
    var reqs = activeReqs(data, termId);
    var locks = activeLocks(data, termId);
    function tName(id) { return teachers[id] ? (teachers[id].short_name || teachers[id].name) : id; }
    function cName(id) { return classMap[id] ? classMap[id].name : id; }
    function sName(id) { return subjects[id] ? subjects[id].name : id; }

    // P04 จำนวนคาบต่อชั้น
    if (tp.length) {
      periodSummary(data, termId).forEach(function (s) {
        if (s.diff !== 0) err('P04', s.label, s.class_id);
      });
    }

    // P05 การอ้างอิง / P06 ภาคเรียนเฉพาะ / P13 ซ้ำ
    var seen = {};
    reqs.forEach(function (r) {
      var where = cName(r.class_id) + ' ' + sName(r.subject_id) + ' (' + r.req_id + ')';
      if (!classMap[r.class_id] || classMap[r.class_id].status !== 'ใช้งาน') err('P05', where + ': ไม่พบชั้นหรือชั้นปิดใช้งาน', r.req_id);
      var s = subjects[r.subject_id];
      if (!s || s.status !== 'ใช้งาน') err('P05', where + ': ไม่พบวิชาหรือวิชาปิดใช้งาน', r.req_id);
      if (!(Number(r.periods) >= 1)) err('P05', where + ': จำนวนคาบต้องเป็นจำนวนเต็มตั้งแต่ 1', r.req_id);
      if (!r.group_id) {
        if (!r.teacher_id) err('P05', where + ': ยังไม่มีครูผู้สอน', r.req_id);
        else if (!teachers[r.teacher_id] || teachers[r.teacher_id].status !== 'ใช้งาน') err('P05', where + ': ไม่พบครู ' + r.teacher_id + ' หรือครูปิดใช้งาน', r.req_id);
      }
      if (r.co_teacher_id) {
        if (!teachers[r.co_teacher_id] || teachers[r.co_teacher_id].status !== 'ใช้งาน') err('P05', where + ': ไม่พบครูประกบ ' + r.co_teacher_id, r.req_id);
        if (r.co_teacher_id === r.teacher_id) err('P05', where + ': ครูผู้สอนกับครูประกบเป็นคนเดียวกัน', r.req_id);
      }
      if (s && s.semester_only !== null && s.semester_only !== '' && s.semester_only !== undefined && Number(s.semester_only) !== Number(term.semester))
        err('P06', where + ': วิชานี้ใช้เฉพาะภาคเรียนที่ ' + s.semester_only + ' แต่อยู่ในภาคเรียนที่ ' + term.semester, r.req_id);
      try { parseNumList(r.allowed_days); parseNumList(r.allowed_periods); }
      catch (e) { err('P05', where + ': ' + e.message, r.req_id); }
      var k = [r.class_id, r.subject_id, r.teacher_id, r.co_teacher_id].join('|');
      if (seen[k]) warn('P13', where + ': ซ้ำกับ ' + seen[k] + ' (ควรรวมเป็นแถวเดียว)', r.req_id);
      else seen[k] = r.req_id;
    });

    // P08 กิจกรรมล็อกเวลา
    var lockSlotClass = {}, lockSlotTeacher = {};
    locks.forEach(function (l) {
      var at = 'วัน' + DAY_NAMES_SAFE[l.day] + ' คาบ ' + l.period;
      if (schoolDays(data).indexOf(Number(l.day)) < 0 || tp.indexOf(Number(l.period)) < 0)
        err('P08', sName(l.subject_id) + ': ' + at + ' ไม่ใช่คาบเรียน', l.lock_id);
      splitIds(l.class_ids).forEach(function (c) {
        if (!classMap[c]) err('P08', sName(l.subject_id) + ': ไม่พบชั้น ' + c, l.lock_id);
        var k = slotKey(l.day, l.period) + '|' + c;
        if (lockSlotClass[k]) err('P08', cName(c) + ' ' + at + ': มีกิจกรรมล็อก 2 รายการ', l.lock_id);
        lockSlotClass[k] = l.lock_id;
      });
      splitIds(l.teacher_ids).forEach(function (t) {
        if (!teachers[t]) err('P08', sName(l.subject_id) + ': ไม่พบครู ' + t, l.lock_id);
        if (blockedSlots(data, termId, t)[slotKey(l.day, l.period)]) err('P08', tName(t) + ' ไม่ว่าง ' + at + ' แต่ถูกจองในกิจกรรม ' + sName(l.subject_id), l.lock_id);
        var k = slotKey(l.day, l.period) + '|' + t;
        if (lockSlotTeacher[k]) err('P08', tName(t) + ' ' + at + ': ถูกจองในกิจกรรมล็อก 2 รายการ', l.lock_id);
        lockSlotTeacher[k] = l.lock_id;
      });
    });

    // P07 กิจกรรมรวมต้องมีล็อกตรงกัน / P09 จัดลงได้หรือไม่
    reqs.forEach(function (r) {
      var where = cName(r.class_id) + ' ' + sName(r.subject_id);
      var slots;
      try { slots = allowedSlots(data, termId, r); } catch (e) { return; }
      if (r.group_id) {
        var ls = locks.filter(function (l) { return l.group_id === r.group_id && l.subject_id === r.subject_id && splitIds(l.class_ids).indexOf(r.class_id) >= 0; });
        if (!ls.length) err('P07', where + ': กิจกรรมรวม ' + r.group_id + ' ไม่มีเวลาล็อกสำหรับชั้นนี้', r.req_id);
        else if (ls.length !== Number(r.periods)) err('P07', where + ': ต้องการ ' + r.periods + ' คาบ แต่มีเวลาล็อก ' + ls.length + ' คาบ', r.req_id);
        return;
      }
      if (slots.length < Number(r.periods))
        err('P09', where + ': ต้องการ ' + r.periods + ' คาบ แต่มีช่องที่จัดได้เพียง ' + slots.length + ' ช่อง (ตรวจวัน/คาบที่กำหนดและเวลาไม่ว่างของครู)', r.req_id);
    });

    // P10 / P12 ภาระครูเทียบกับเวลาที่ว่าง
    var allSlots = [];
    schoolDays(data).forEach(function (d) { tp.forEach(function (p) { allSlots.push(slotKey(d, p)); }); });
    Object.keys(teachers).forEach(function (tid) {
      var mine = reqs.filter(function (r) { return !r.group_id && (r.teacher_id === tid || r.co_teacher_id === tid); });
      if (!mine.length) return;
      var demand = mine.reduce(function (s, r) { return s + Number(r.periods || 0); }, 0);
      var blocked = blockedSlots(data, termId, tid);
      var free = allSlots.filter(function (k) {
        return !blocked[k] && !locks.some(function (l) { return slotKey(l.day, l.period) === k && splitIds(l.teacher_ids).indexOf(tid) >= 0; });
      });
      if (demand > free.length) err('P10', tName(tid) + ': ต้องสอน ' + demand + ' คาบ แต่มีเวลาว่างเพียง ' + free.length + ' ช่อง', tid);
      var union = {};
      mine.forEach(function (r) { try { allowedSlots(data, termId, r).forEach(function (k) { union[k] = true; }); } catch (e) { } });
      var n = Object.keys(union).length;
      if (n < demand) err('P12', tName(tid) + ': ต้องสอน ' + demand + ' คาบในช่วงที่กำหนด แต่ช่วงดังกล่าวมีเพียง ' + n + ' ช่อง', tid);
      else if (n === demand) warn('P12', tName(tid) + ': ใช้ช่องที่กำหนดเต็มทุกช่อง (' + n + ' ช่อง) — ถ้าตรงกับวันหยุด คาบจะหายทั้งสัปดาห์', tid);
    });

    // P14 ความสามารถครู (ใช้จัดอันดับสอนแทน)
    if ((data.teacherSubjects || []).length) {
      reqs.forEach(function (r) {
        if (!r.teacher_id) return;
        var ok = data.teacherSubjects.some(function (x) { return x.teacher_id === r.teacher_id && x.subject_id === r.subject_id; });
        if (!ok) warn('P14', tName(r.teacher_id) + ' สอน ' + sName(r.subject_id) + ' แต่ไม่มีในแผ่น "ความสามารถครู"', r.req_id);
      });
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /** สร้างรายการ "ครูสอนวิชาใดได้" จากโครงสร้างคาบ (ใช้ตอนนำเข้าข้อมูลครั้งแรก) */
  function deriveTeacherSubjects(requirements) {
    var seen = {}, out = [];
    requirements.forEach(function (r) {
      [r.teacher_id, r.co_teacher_id].forEach(function (t) {
        if (!t) return;
        var k = t + '|' + r.subject_id;
        if (seen[k]) return;
        seen[k] = true;
        out.push({ teacher_id: t, subject_id: r.subject_id });
      });
    });
    return out;
  }

  // ---------- สร้างภาคเรียนใหม่จากภาคเรียนเดิม (ข้อ 36) ----------

  /**
   * คัดลอกเวลาเรียน โครงสร้างคาบ กิจกรรมล็อก และเวลาไม่ว่างของครู ไปยังภาคเรียนใหม่
   * ไม่แก้ไขข้อมูลต้นทาง (คืนแถวใหม่ให้ผู้เรียกบันทึก)
   * target: { year, semester, start_date?, end_date? }
   */
  function copyTermStructure(data, fromTermId, target) {
    var src = byKey(data.terms, 'term_id', fromTermId);
    if (!src) throw new Error('ไม่พบภาคเรียนต้นทาง ' + fromTermId);
    var year = Number(target.year), sem = Number(target.semester);
    if (!(year > 2500) || !(sem >= 1)) throw new Error('ปีการศึกษาหรือภาคเรียนไม่ถูกต้อง');
    var newId = year + '-' + sem;
    if (newId === fromTermId) throw new Error('ภาคเรียนต้นทางและปลายทางต้องไม่ซ้ำกัน');
    var existing = byKey(data.terms, 'term_id', newId);
    if (existing) {
      var used = ['periods', 'requirements', 'locks', 'blocks'].some(function (k) {
        return (data[k] || []).some(function (x) { return x.term_id === newId; });
      });
      if (used) throw new Error('ภาคเรียน ' + sem + '/' + year + ' มีข้อมูลอยู่แล้ว — ระบบไม่เขียนทับ');
    }
    var term = existing ? null : {
      term_id: newId, year: year, semester: sem, start_date: target.start_date || '', end_date: target.end_date || '',
      status: 'อนาคต', is_current: false, schedule_status: 'ยังไม่จัด', published_at: '',
      note: 'คัดลอกโครงสร้างจาก ' + src.semester + '/' + src.year
    };
    function copy(o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; c.term_id = newId; return c; }

    var periods = (data.periods || []).filter(function (p) { return p.term_id === fromTermId; }).map(function (p) {
      var c = copy(p); c.period_id = newId + '-' + p.period_no; return c;
    });
    var reqIds = (data.requirements || []).map(function (r) { return r.req_id; });
    var subjects = {}; (data.subjects || []).forEach(function (s) { subjects[s.subject_id] = s; });
    var warnings = [];
    var requirements = (data.requirements || []).filter(function (r) { return r.term_id === fromTermId; }).map(function (r) {
      var c = copy(r); c.req_id = nextId('R', reqIds, 4); reqIds.push(c.req_id);
      var s = subjects[r.subject_id];
      if (s && s.semester_only !== '' && s.semester_only !== null && s.semester_only !== undefined && Number(s.semester_only) !== sem)
        warnings.push(s.name + ' (' + r.class_id + ') ใช้เฉพาะภาคเรียนที่ ' + s.semester_only + ' — คัดลอกมาแล้ว กรุณาตรวจและปิดใช้งานหากไม่ต้องการ (' + c.req_id + ')');
      return c;
    });
    var lockIds = (data.locks || []).map(function (l) { return l.lock_id; });
    var locks = (data.locks || []).filter(function (l) { return l.term_id === fromTermId; }).map(function (l) {
      var c = copy(l); c.lock_id = nextId('L', lockIds, 3); lockIds.push(c.lock_id); return c;
    });
    var blockIds = (data.blocks || []).map(function (b) { return b.block_id; });
    var blocks = (data.blocks || []).filter(function (b) { return b.term_id === fromTermId; }).map(function (b) {
      var c = copy(b); c.block_id = nextId('B', blockIds, 3); blockIds.push(c.block_id); return c;
    });
    return { term_id: newId, term: term, periods: periods, requirements: requirements, locks: locks, blocks: blocks, warnings: warnings };
  }

  return {
    byKey: byKey, parseNumList: parseNumList, splitIds: splitIds, nextId: nextId, slotKey: slotKey,
    teachingPeriods: teachingPeriods, schoolDays: schoolDays, weeklyCapacity: weeklyCapacity,
    isIsoDate: isIsoDate, dayOfWeek: dayOfWeek, termForDate: termForDate, describeDate: describeDate,
    periodSummary: periodSummary, teacherLoads: teacherLoads, blockedSlots: blockedSlots, allowedSlots: allowedSlots,
    preScheduleChecks: preScheduleChecks, deriveTeacherSubjects: deriveTeacherSubjects, copyTermStructure: copyTermStructure
  };
})();
