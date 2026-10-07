/**
 * Scheduler.gs — จัดตารางเรียนประจำสัปดาห์ (Master Schedule) แบบ Constraint-Based (Phase 5)
 *
 * หลักการ (ข้อ 21):
 *  - ไม่มีการสุ่ม: ข้อมูลเดิมได้ผลเดิมทุกครั้ง (เรียงลำดับด้วยรหัสเสมอ)
 *  - กฎบังคับ (ห้ามฝ่าฝืน): กิจกรรมล็อกเวลา, ครูประกบว่างพร้อมกัน, เวลาไม่ว่างของครู,
 *    ครูไม่สอน 2 ห้องพร้อมกัน, ชั้นไม่เรียน 2 วิชาพร้อมกัน, จำนวนคาบตรงโครงสร้าง, วัน/คาบที่กำหนด
 *  - กฎพึงประสงค์ (ใช้จัดลำดับเท่านั้น): วิชาหลักช่วงเช้า, วิชาเดียวกันไม่ซ้ำวัน, ภาระครูต่อวันไม่กระจุก
 *  - ไม่เปลี่ยนจำนวนคาบ ครู หรือวิชา — ถ้าจัดไม่ได้ จะหยุดและรายงานสาเหตุ
 *
 * วิธี: Backtracking + เลือกคาบที่มีทางเลือกน้อยที่สุดก่อน (MRV) แล้วปรับปรุงด้วยการสลับคาบภายในชั้น
 */

var Scheduler = (function () {
  var COST_CORE_AFTERNOON = 10;   // วิชาหลักอยู่ช่วงบ่าย
  var COST_NONCORE_MORNING = 1;   // วิชาอื่นใช้ช่วงเช้า (เพื่อเหลือช่วงเช้าให้วิชาหลัก)
  var COST_SAME_DAY = 30;         // วิชาเดียวกันเกินจำนวนต่อวันที่กำหนด
  var COST_TEACHER_DAY = 3;       // ครูสอนเกินจำนวนคาบต่อวันที่พึงประสงค์
  var COST_SAME_PERIOD = 3;       // วิชาเดียวกันของชั้นเดียวกันอยู่คาบเดิมซ้ำหลายวัน (ต่อครั้งที่ซ้ำ)
  var COST_TEACHER_ADJ = 2;       // ครูสอนคาบติดกัน (ต่อคู่) — อยากให้ "คาบเว้นคาบ"
  var COST_TEACHER_BAL = 1.5;     // ครูสอนเช้า/บ่ายไม่สมดุลในวันเดียวกัน (ต่อคาบที่ต่างเกิน 1)
  var COST_TEACHER_PERIOD = 0.3;  // ครูสอนคาบเลขเดิมซ้ำหลายวัน (ช่วยกระจายเวลาสอนของครูทั้งวัน)
  var NODE_LIMIT = 400000;

  function generate(data, termId, options) {
    options = options || {};
    var R = Rules;
    var days = R.schoolDays(data), tp = R.teachingPeriods(data, termId);
    var morning = R.parseNumList(R.byKey(data.settings, 'key', 'morning_periods') ? R.byKey(data.settings, 'key', 'morning_periods').value : '1-3') || [];
    var maxSame = Number((R.byKey(data.settings, 'key', 'max_same_subject_per_day') || {}).value || 1);
    var maxTeacherDay = Number((R.byKey(data.settings, 'key', 'max_teacher_periods_per_day') || {}).value || 5);
    function setting(k, def) { var x = R.byKey(data.settings || [], 'key', k); return x && String(x.value).trim() !== '' ? String(x.value).trim() : def; }
    // ค่าตามคำสั่ง Admin 7 ต.ค. 2569: ไม่บังคับวิชาหลักช่วงเช้า / ครูวิชาหลักสอนช่วงเช้าไม่เกินวันละ 2 คาบ / ไม่ให้วิชาอยู่คาบเดิมทุกวัน
    var corePref = setting('core_morning_preference', 'ไม่ใช้') === 'ใช้';
    var capSetting = setting('core_teacher_max_morning_per_day', '2');
    var morningCap = capSetting === '' || capSetting === 'ไม่จำกัด' ? null : Number(capSetting);
    var avoidSamePeriod = setting('avoid_same_period_repeat', 'ใช้') === 'ใช้';
    var teacherSpread = setting('teacher_spread', 'ใช้') === 'ใช้';
    var subjects = {}; (data.subjects || []).forEach(function (s) { subjects[s.subject_id] = s; });

    var reqs = (data.requirements || []).filter(function (r) { return r.term_id === termId && r.status === 'ใช้งาน'; })
      .sort(function (a, b) { return a.req_id < b.req_id ? -1 : 1; });
    var locks = (data.locks || []).filter(function (l) { return l.term_id === termId && l.status === 'ใช้งาน'; });

    // ---- สถานะ ----
    var classAt = {}, teacherAt = {}, subjDay = {}, teacherDay = {};
    function k2(a, b) { return a + '|' + b; }
    function busyT(t, s) { return teacherAt[k2(t, s)]; }

    // กิจกรรมล็อก: วางก่อนและไม่ย้าย
    var fixed = [];
    locks.forEach(function (l) {
      var s = R.slotKey(l.day, l.period);
      R.splitIds(l.teacher_ids).forEach(function (t) { teacherAt[k2(t, s)] = 'LOCK:' + l.lock_id; });
      R.splitIds(l.class_ids).forEach(function (c) {
        var r = reqs.filter(function (x) { return x.group_id && x.group_id === l.group_id && x.class_id === c && x.subject_id === l.subject_id; })[0];
        if (!r) return;
        var u = { uid: r.req_id + '#L' + l.lock_id, req: r, day: Number(l.day), period: Number(l.period), fixed: true, lock: l };
        classAt[k2(c, s)] = u;
        fixed.push(u);
      });
    });

    // หน่วยคาบที่ต้องจัด
    var units = [];
    reqs.filter(function (r) { return !r.group_id; }).forEach(function (r) {
      var dom = R.allowedSlots(data, termId, r).map(function (k) { var p = k.split('-'); return { key: k, day: Number(p[0]), period: Number(p[1]) }; });
      for (var i = 0; i < Number(r.periods); i++) {
        units.push({ uid: r.req_id + '#' + (i + 1), req: r, domain: dom, day: null, period: null,
          core: !!(subjects[r.subject_id] && subjects[r.subject_id].is_core) });
      }
    });

    // ครูวิชาหลัก = ครูที่เป็นผู้สอนวิชาหลักอย่างน้อยหนึ่งวิชา
    var coreTeacher = {};
    units.forEach(function (u) { if (u.core && u.req.teacher_id) coreTeacher[u.req.teacher_id] = true; });
    var teacherMorning = {}, subjPeriod = {}, teacherPeriod = {};
    var sameLimit = maxSame, capLimit = morningCap;
    function morningOk(t, sl) {
      if (!t || capLimit === null || !coreTeacher[t] || morning.indexOf(sl.period) < 0) return true;
      return (teacherMorning[k2(t, sl.day)] || 0) < capLimit;
    }
    function canPlace(u, sl) {
      var r = u.req, s = sl.key;
      if (classAt[k2(r.class_id, s)]) return false;
      if (r.teacher_id && busyT(r.teacher_id, s)) return false;
      if (r.co_teacher_id && busyT(r.co_teacher_id, s)) return false;
      if ((subjDay[r.class_id + '|' + r.subject_id + '|' + sl.day] || 0) >= sameLimit) return false;
      if (!morningOk(r.teacher_id, sl) || !morningOk(r.co_teacher_id, sl)) return false;
      return true;
    }
    function bump(map, key, d) { map[key] = (map[key] || 0) + d; }
    function track(u, day, period, d) {
      var r = u.req, inM = morning.indexOf(period) >= 0;
      [r.teacher_id, r.co_teacher_id].forEach(function (t) {
        if (!t) return;
        if (inM) bump(teacherMorning, k2(t, day), d);
        bump(teacherPeriod, k2(t, period), d);
      });
      bump(subjPeriod, r.class_id + '|' + r.subject_id + '|' + period, d);
    }
    function place(u, sl) {
      var r = u.req, s = sl.key;
      u.day = sl.day; u.period = sl.period;
      classAt[k2(r.class_id, s)] = u;
      if (r.teacher_id) { teacherAt[k2(r.teacher_id, s)] = u; teacherDay[k2(r.teacher_id, sl.day)] = (teacherDay[k2(r.teacher_id, sl.day)] || 0) + 1; }
      if (r.co_teacher_id) { teacherAt[k2(r.co_teacher_id, s)] = u; teacherDay[k2(r.co_teacher_id, sl.day)] = (teacherDay[k2(r.co_teacher_id, sl.day)] || 0) + 1; }
      var sk = r.class_id + '|' + r.subject_id + '|' + sl.day; subjDay[sk] = (subjDay[sk] || 0) + 1;
      track(u, sl.day, sl.period, 1);
    }
    function unplace(u) {
      var r = u.req, s = R.slotKey(u.day, u.period);
      delete classAt[k2(r.class_id, s)];
      if (r.teacher_id) { delete teacherAt[k2(r.teacher_id, s)]; teacherDay[k2(r.teacher_id, u.day)]--; }
      if (r.co_teacher_id) { delete teacherAt[k2(r.co_teacher_id, s)]; teacherDay[k2(r.co_teacher_id, u.day)]--; }
      subjDay[r.class_id + '|' + r.subject_id + '|' + u.day]--;
      track(u, u.day, u.period, -1);
      u.day = null; u.period = null;
    }
    // รูปแบบวันของครู: นับคู่คาบติดกัน (ไม่นับข้ามพักกลางวัน) และความต่างเช้า/บ่าย
    function dayPattern(t, d, extra) {
      var adj = 0, m = 0, a = 0, prev = null;
      for (var i = 0; i < tp.length; i++) {
        var p = tp[i];
        var occ = p === extra || !!teacherAt[k2(t, R.slotKey(d, p))];
        var inM = morning.indexOf(p) >= 0;
        if (occ) { if (inM) m++; else a++; }
        if (occ && prev && prev.occ && prev.inM === inM) adj++;
        prev = { occ: occ, inM: inM };
      }
      return COST_TEACHER_ADJ * adj + COST_TEACHER_BAL * Math.max(0, Math.abs(m - a) - 1);
    }
    var allTeachers = {};
    units.forEach(function (u) { if (u.req.teacher_id) allTeachers[u.req.teacher_id] = 1; if (u.req.co_teacher_id) allTeachers[u.req.co_teacher_id] = 1; });
    function valueCost(u, sl) {
      var c = 0, inMorning = morning.indexOf(sl.period) >= 0;
      if (corePref && u.core && !inMorning) c += COST_CORE_AFTERNOON;
      if (corePref && !u.core && inMorning) c += COST_NONCORE_MORNING;
      var r = u.req;
      if (avoidSamePeriod) c += COST_SAME_PERIOD * (subjPeriod[r.class_id + '|' + r.subject_id + '|' + sl.period] || 0);
      [r.teacher_id, r.co_teacher_id].forEach(function (t) { if (t) c += COST_TEACHER_PERIOD * (teacherPeriod[k2(t, sl.period)] || 0); });
      if (teacherSpread) [r.teacher_id, r.co_teacher_id].forEach(function (t) { if (t) c += dayPattern(t, sl.day, sl.period) - dayPattern(t, sl.day, null); });
      [r.teacher_id, r.co_teacher_id].forEach(function (t) { if (t && (teacherDay[k2(t, sl.day)] || 0) >= maxTeacherDay) c += COST_TEACHER_DAY; });
      // กระจายวัน: วิชาเดียวกันในวันติดกันมีต้นทุนเล็กน้อย
      if ((subjDay[r.class_id + '|' + r.subject_id + '|' + (sl.day - 1)] || 0) + (subjDay[r.class_id + '|' + r.subject_id + '|' + (sl.day + 1)] || 0) > 0) c += 0.2;
      return c;
    }

    // ---- ค้นหาแบบ Backtracking ----
    // หน่วยคาบของวิชาเดียวกันสลับกันได้ จึงบังคับให้จัดตามลำดับช่องเวลา (ตัดคำตอบซ้ำ) และเลือกโครงสร้างที่ทางเลือกน้อยที่สุดก่อน
    var P = tp.length;
    function idxOf(sl) { return (sl.day - 1) * 100 + sl.period; }
    var groups = [];
    reqs.filter(function (r) { return !r.group_id; }).forEach(function (r) {
      var us = units.filter(function (u) { return u.req === r; });
      groups.push({ req: r, units: us, placed: 0, last: -1, domain: us[0] ? us[0].domain : [] });
    });
    var nodes = 0, deadEnds = {}, started = Date.now(), timeLimit = options.timeLimitMs || 150000, timedOut = false;
    function candidates(g) {
      var out = [];
      var u = g.units[g.placed];
      for (var i = 0; i < g.domain.length; i++) {
        var sl = g.domain[i];
        if (idxOf(sl) > g.last && canPlace(u, sl)) out.push(sl);
      }
      return out;
    }
    function enoughRoom(g, cands) {
      var need = g.units.length - g.placed;
      if (cands.length < need) return false;
      if (sameLimit === 1) {
        var ds = {}; cands.forEach(function (c) { ds[c.day] = 1; });
        if (Object.keys(ds).length < need) return false;
      }
      return true;
    }
    function solve() {
      if (++nodes > NODE_LIMIT) return false;
      if ((nodes & 255) === 0 && Date.now() - started > timeLimit) { timedOut = true; return false; }
      var best = null, bestC = null, bestScore = Infinity;
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (g.placed === g.units.length) continue;
        var c = candidates(g);
        if (!enoughRoom(g, c)) { deadEnds[g.req.req_id] = (deadEnds[g.req.req_id] || 0) + 1; return false; }
        var score = c.length / (g.units.length - g.placed);
        if (score < bestScore || (score === bestScore && ((g.req.priority || 9) < (best.req.priority || 9) ||
          ((g.req.priority || 9) === (best.req.priority || 9) && g.req.req_id < best.req.req_id)))) { best = g; bestC = c; bestScore = score; }
      }
      if (!best) return true;
      var u = best.units[best.placed];
      bestC.sort(function (a, b) { return valueCost(u, a) - valueCost(u, b) || a.day - b.day || a.period - b.period; });
      for (var j = 0; j < bestC.length; j++) {
        var prevLast = best.last;
        place(u, bestC[j]); best.placed++; best.last = idxOf(bestC[j]);
        if (solve()) return true;
        best.placed--; best.last = prevLast; unplace(u);
        if (timedOut || nodes > NODE_LIMIT) return false;
      }
      return false;
    }

    // ลองตามลำดับ: กฎครบ → ผ่อน "วิชาเดียวกันต่อวัน" → ผ่อนเพดานช่วงเช้าของครูวิชาหลักทีละ 1 คาบ (แจ้งทุกครั้ง)
    var attempts = [{ same: maxSame, cap: morningCap }];
    if (maxSame < 2) attempts.push({ same: 2, cap: morningCap });
    if (morningCap !== null) { attempts.push({ same: maxSame, cap: morningCap + 1 }); attempts.push({ same: 2, cap: morningCap + 1 }); }
    var relaxed = false, capRelaxed = false, ok = false;
    for (var ai = 0; ai < attempts.length && !ok; ai++) {
      if (ai > 0) {
        units.forEach(function (u) { if (u.day !== null) unplace(u); });
        groups.forEach(function (g) { g.placed = 0; g.last = -1; });
        nodes = 0; deadEnds = {}; timedOut = false; started = Date.now();
      }
      sameLimit = attempts[ai].same; capLimit = attempts[ai].cap;
      ok = solve();
      if (ok) { relaxed = sameLimit !== maxSame; capRelaxed = capLimit !== morningCap; }
    }
    if (!ok) {
      var worst = Object.keys(deadEnds).sort(function (a, b) { return deadEnds[b] - deadEnds[a] || (a < b ? -1 : 1); }).slice(0, 5);
      return {
        ok: false, nodes: nodes,
        message: (timedOut || nodes > NODE_LIMIT) ? 'จัดตารางไม่สำเร็จภายในเวลาที่กำหนด (ยังไม่พบคำตอบ ไม่ได้แปลว่าจัดไม่ได้)' : 'ไม่มีวิธีจัดที่ไม่ขัดกฎบังคับ',
        hard_spots: worst.map(function (rid) {
          var u = units.filter(function (x) { return x.req.req_id === rid; })[0];
          return { req_id: u.req.req_id, class_id: u.req.class_id, subject_id: u.req.subject_id, teacher_id: u.req.teacher_id, co_teacher_id: u.req.co_teacher_id };
        })
      };
    }

    // ---- ปรับปรุงด้วยการสลับคาบภายในชั้นเดียวกัน (ยังเคารพกฎบังคับทุกข้อ) ----
    function totalCost() {
      var c = 0;
      units.forEach(function (u) {
        var inMorning = morning.indexOf(u.period) >= 0;
        if (corePref && u.core && !inMorning) c += COST_CORE_AFTERNOON;
        if (corePref && !u.core && inMorning) c += COST_NONCORE_MORNING;
      });
      if (avoidSamePeriod) Object.keys(subjPeriod).forEach(function (k) { if (subjPeriod[k] > 1) c += COST_SAME_PERIOD * (subjPeriod[k] - 1) * subjPeriod[k] / 2; });
      Object.keys(teacherPeriod).forEach(function (k) { if (teacherPeriod[k] > 1) c += COST_TEACHER_PERIOD * (teacherPeriod[k] - 1) * teacherPeriod[k] / 2; });
      Object.keys(subjDay).forEach(function (k) { if (subjDay[k] > maxSame) c += COST_SAME_DAY * (subjDay[k] - maxSame); });
      Object.keys(teacherDay).forEach(function (k) { if (teacherDay[k] > maxTeacherDay) c += COST_TEACHER_DAY * (teacherDay[k] - maxTeacherDay); });
      if (teacherSpread) Object.keys(allTeachers).forEach(function (t) { days.forEach(function (d) { c += dayPattern(t, d, null); }); });
      return c;
    }
    function inDomain(u, day, period) { return u.domain.some(function (sl) { return sl.day === day && sl.period === period; }); }
    var cost = totalCost(), improved = true, sweeps = 0;
    sameLimit = 99; // ระหว่างสลับ ใช้ต้นทุนแทนการห้าม
    while (improved && sweeps < 20) {
      improved = false; sweeps++;
      for (var a = 0; a < units.length; a++) {
        for (var b = a + 1; b < units.length; b++) {
          var ua = units[a], ub = units[b];
          if (ua.req.class_id !== ub.req.class_id || ua.req.req_id === ub.req.req_id) continue;
          var da = ua.day, pa = ua.period, db = ub.day, pb = ub.period;
          if (!inDomain(ua, db, pb) || !inDomain(ub, da, pa)) continue;
          unplace(ua); unplace(ub);
          var sa = { key: R.slotKey(db, pb), day: db, period: pb }, sb = { key: R.slotKey(da, pa), day: da, period: pa };
          var okA = canPlace(ua, sa); if (okA) place(ua, sa);
          var okB = okA && canPlace(ub, sb); if (okB) place(ub, sb);
          var nc = okA && okB ? totalCost() : Infinity;
          if (nc < cost - 1e-9) { cost = nc; improved = true; continue; }
          if (okA && ua.day !== null) unplace(ua);
          if (okB && ub.day !== null) unplace(ub);
          place(ua, { key: R.slotKey(da, pa), day: da, period: pa });
          place(ub, { key: R.slotKey(db, pb), day: db, period: pb });
        }
      }
    }

    // ---- ผลลัพธ์ ----
    var slots = fixed.map(function (u) {
      return { day: u.day, period: u.period, class_id: u.req.class_id, subject_id: u.req.subject_id, teacher_id: '', co_teacher_id: '',
        req_id: u.req.req_id, source: 'ล็อก' };
    }).concat(units.map(function (u) {
      return { day: u.day, period: u.period, class_id: u.req.class_id, subject_id: u.req.subject_id, teacher_id: u.req.teacher_id || '',
        co_teacher_id: u.req.co_teacher_id || '', req_id: u.req.req_id, source: 'อัตโนมัติ' };
    })).sort(function (x, y) { return x.class_id < y.class_id ? -1 : x.class_id > y.class_id ? 1 : x.day - y.day || x.period - y.period; });

    var coreAfternoon = units.filter(function (u) { return u.core && morning.indexOf(u.period) < 0; });
    var cname = {}; (data.classes || []).forEach(function (c) { cname[c.class_id] = c.name; });
    var tname = {}; (data.teachers || []).forEach(function (t) { tname[t.teacher_id] = t.short_name || t.name; });
    var notes = [];
    if (relaxed) notes.push('จัดไม่ได้ถ้าห้ามวิชาเดียวกันเกิน ' + maxSame + ' คาบ/วัน จึงยอมให้ไม่เกิน 2 คาบ/วันในบางวิชา');
    if (capRelaxed) notes.push('จัดไม่ได้ถ้าครูวิชาหลักสอนช่วงเช้าไม่เกิน ' + morningCap + ' คาบ/วัน จึงผ่อนเป็น ' + capLimit + ' คาบ/วัน');
    if (morningCap !== null && !capRelaxed) notes.push('ครูวิชาหลักสอนช่วงเช้าไม่เกิน ' + morningCap + ' คาบ/วัน ทุกคน ทุกวัน');
    var maxM = 0; Object.keys(teacherMorning).forEach(function (k) { if (coreTeacher[k.split('|')[0]]) maxM = Math.max(maxM, teacherMorning[k]); });
    if (corePref) {
      var byClass = {};
      coreAfternoon.forEach(function (u) { byClass[u.req.class_id] = (byClass[u.req.class_id] || 0) + 1; });
      Object.keys(byClass).sort().forEach(function (c) { notes.push('วิชาหลักอยู่ช่วงบ่าย ' + (cname[c] || c) + ': ' + byClass[c] + ' คาบ'); });
    } else {
      notes.push('วิชาหลักอยู่ช่วงเช้า ' + (units.filter(function (u) { return u.core; }).length - coreAfternoon.length) + ' คาบ ช่วงบ่าย ' + coreAfternoon.length + ' คาบ (ไม่บังคับช่วงเช้า)');
    }
    var maxRepeat = 0; Object.keys(subjPeriod).forEach(function (k) { maxRepeat = Math.max(maxRepeat, subjPeriod[k]); });
    if (avoidSamePeriod) notes.push('วิชาเดียวกันอยู่คาบเลขเดิมซ้ำมากที่สุด ' + maxRepeat + ' วันต่อสัปดาห์');
    var adjPairs = 0, oneSided = 0, tdays = 0;
    Object.keys(allTeachers).forEach(function (t) {
      days.forEach(function (d) {
        var occ = tp.map(function (p) { return !!teacherAt[k2(t, R.slotKey(d, p))]; });
        var m = 0, a = 0;
        tp.forEach(function (p, i) { if (occ[i]) { if (morning.indexOf(p) >= 0) m++; else a++; } if (i && occ[i] && occ[i - 1] && (morning.indexOf(p) >= 0) === (morning.indexOf(tp[i - 1]) >= 0)) adjPairs++; });
        if (m + a >= 2) { tdays++; if (m === 0 || a === 0) oneSided++; }
      });
    });
    if (teacherSpread) notes.push('ครูสอนคาบติดกัน ' + adjPairs + ' คู่ทั้งสัปดาห์ · วันที่ครูสอนแต่เช้าล้วนหรือบ่ายล้วน ' + oneSided + ' จาก ' + tdays + ' วัน');
    var overSame = Object.keys(subjDay).filter(function (k) { return subjDay[k] > maxSame; });
    if (overSame.length) notes.push('วิชาเดียวกันเกิน ' + maxSame + ' คาบ/วัน: ' + overSame.length + ' กรณี');
    return { ok: true, slots: slots, cost: cost, nodes: nodes, sweeps: sweeps, relaxed: relaxed, notes: notes,
      stats: { units: units.length, fixed: fixed.length, core_afternoon: coreAfternoon.length, over_same_day: overSame.length, max_core_teacher_morning: maxM, max_same_period: maxRepeat, cap_used: capLimit } };
  }

  return { generate: generate };
})();
