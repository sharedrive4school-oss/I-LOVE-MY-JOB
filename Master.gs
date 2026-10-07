/**
 * Master.gs — ตารางเรียนประจำสัปดาห์ (Master Schedule): จัด → บันทึกร่าง → ตรวจ → เผยแพร่ (Phase 5)
 *
 * - ทุกฉบับเก็บไว้ (ร่าง / เผยแพร่แล้ว / เก็บถาวร) ไม่มีการลบหรือเขียนทับ
 * - ฉบับที่เคยเผยแพร่มี "ใช้ตั้งแต่วันที่" จึงย้อนดูได้ว่าวันใดใช้ตารางฉบับไหน
 * - บันทึกและเผยแพร่ได้เฉพาะตารางที่ไม่มีความขัดแย้ง (ข้อ 23–24)
 */

var Master = (function () {

  function slotsOf(termId, predicate) {
    return Db.all('Master').filter(function (m) { return m.term_id === termId && predicate(m); });
  }

  function versions(termId) {
    var map = {};
    Db.all('Master').filter(function (m) { return m.term_id === termId; }).forEach(function (m) {
      var v = map[m.version] = map[m.version] || { version: m.version, status: m.status, effective_from: m.effective_from, count: 0 };
      v.count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.version - b.version; });
  }

  function cleanSlot(s) {
    return { day: Number(s.day), period: Number(s.period), class_id: String(s.class_id || ''), subject_id: String(s.subject_id || ''),
      teacher_id: String(s.teacher_id || ''), co_teacher_id: String(s.co_teacher_id || ''), req_id: String(s.req_id || ''),
      source: ENUMS.SLOT_SOURCE.indexOf(s.source) >= 0 ? s.source : 'แก้มือ' };
  }

  /** จัดตารางอัตโนมัติ — คืนผล (ยังไม่บันทึก) */
  function generateDraft(ctx, payload) {
    var termId = requireTerm_(payload.term_id);
    var data = Db.loadData();
    var pre = Rules.preScheduleChecks(data, termId);
    if (!pre.ok) throw new AppError('PRECHECK', 'ยังจัดตารางไม่ได้ เพราะข้อมูลมีปัญหา ' + pre.errors.length + ' รายการ', pre.errors);
    var res = Scheduler.generate(data, termId, { timeLimitMs: 240000 });
    if (!res.ok) {
      var names = function (id, list, key, f) { var x = Rules.byKey(list, key, id); return x ? x[f] : id; };
      var spots = (res.hard_spots || []).map(function (h) {
        return names(h.class_id, data.classes, 'class_id', 'name') + ' ' + names(h.subject_id, data.subjects, 'subject_id', 'name') +
          (h.teacher_id ? ' (' + names(h.teacher_id, data.teachers, 'teacher_id', 'short_name') + ')' : '');
      });
      throw new AppError('SCHEDULE_FAILED', res.message + (spots.length ? ' — จุดที่จัดยากที่สุด: ' + spots.join(', ') : ''), res.hard_spots);
    }
    var check = ScheduleValidator.validateSchedule(data, termId, res.slots);
    if (!check.ok) throw new AppError('INTERNAL', 'ตัวจัดตารางให้ผลที่ไม่ผ่านการตรวจ (ไม่ได้บันทึก): ' + ScheduleValidator.summarize(check), check.errors);
    return { term_id: termId, slots: res.slots, notes: res.notes, stats: res.stats, warnings: check.warnings.concat(pre.warnings) };
  }

  /** บันทึกเป็นฉบับร่างใหม่ — ปฏิเสธถ้ามีความขัดแย้ง */
  function saveDraft(ctx, payload) {
    var termId = requireTerm_(payload.term_id);
    if (!payload.slots || !payload.slots.length) throw new AppError('VALIDATION', 'ไม่มีข้อมูลตาราง');
    var slots = payload.slots.map(cleanSlot);
    var c = { user: ctx.user, reason: payload.reason || 'บันทึกตารางฉบับร่าง', unlockReason: payload.unlockReason || '' };
    return Db.withLock(function () {
      var data = Db.loadData();
      var check = ScheduleValidator.validateSchedule(data, termId, slots);
      if (!check.ok) {
        throw new AppError('CONFLICT', 'ไม่สามารถบันทึกตารางได้\n' + ScheduleValidator.summarize(check), check.errors);
      }
      var vs = versions(termId);
      var version = vs.length ? vs[vs.length - 1].version + 1 : 1;
      Db.updateWhere('Master', function (m) { return m.term_id === termId && m.status === 'ร่าง'; }, { status: 'เก็บถาวร' }, c, 'เก็บถาวรฉบับร่างเดิม');
      Db.insertMany('Master', slots.map(function (s) {
        var o = cleanSlot(s); o.term_id = termId; o.version = version; o.status = 'ร่าง'; o.effective_from = ''; return o;
      }), c, 'บันทึกตารางฉบับร่าง ' + version);
      var t = Db.get('Terms', termId);
      if (t.schedule_status !== 'ร่าง' && t.schedule_status !== 'เผยแพร่แล้ว') Db.update('Terms', termId, { schedule_status: 'ร่าง' }, c);
      return { term_id: termId, version: version, count: slots.length, warnings: check.warnings };
    });
  }

  /** ตรวจสอบตารางทั้งหมด (ปุ่มข้อ 24) — ฉบับร่างล่าสุด หรือระบุ version */
  function checkAll(ctx, payload) {
    var termId = requireTerm_(payload.term_id);
    var data = Db.loadData();
    var v = payload.version ? Number(payload.version) : latestVersion(termId, 'ร่าง');
    if (!v) throw new AppError('NOT_FOUND', 'ยังไม่มีตารางฉบับร่าง');
    var slots = slotsOf(termId, function (m) { return m.version === v; });
    var check = ScheduleValidator.validateSchedule(data, termId, slots);
    var pre = Rules.preScheduleChecks(data, termId);
    var res = { ok: check.ok && pre.ok, version: v, errors: pre.errors.concat(check.errors), warnings: check.warnings.concat(pre.warnings) };
    res.run_id = saveCheckRun_(termId, res);
    res.message = res.ok ? '✅ ไม่พบความขัดแย้ง สามารถเผยแพร่ตารางได้' : '❌ พบความขัดแย้ง ไม่สามารถเผยแพร่ตารางได้';
    return res;
  }

  function latestVersion(termId, status) {
    var vs = versions(termId).filter(function (v) { return !status || v.status === status; });
    return vs.length ? vs[vs.length - 1].version : null;
  }

  /** เผยแพร่ — ตรวจซ้ำกับข้อมูลล่าสุดทุกครั้ง */
  function publish(ctx, payload) {
    var termId = requireTerm_(payload.term_id);
    var c = { user: ctx.user, reason: payload.reason || 'เผยแพร่ตาราง', unlockReason: payload.unlockReason || '' };
    var eff = payload.effective_from || Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd');
    if (!Rules.isIsoDate(eff)) throw new AppError('VALIDATION', 'วันที่เริ่มใช้ไม่ถูกต้อง');
    return Db.withLock(function () {
      var v = payload.version ? Number(payload.version) : latestVersion(termId, 'ร่าง');
      if (!v) throw new AppError('NOT_FOUND', 'ยังไม่มีตารางฉบับร่างให้เผยแพร่');
      var rows = slotsOf(termId, function (m) { return m.version === v; });
      if (!rows.length || rows[0].status !== 'ร่าง') throw new AppError('VALIDATION', 'เผยแพร่ได้เฉพาะฉบับร่าง');
      var data = Db.loadData();
      var pre = Rules.preScheduleChecks(data, termId);
      var check = ScheduleValidator.validateSchedule(data, termId, rows);
      if (!pre.ok || !check.ok) {
        throw new AppError('CONFLICT', '❌ พบความขัดแย้ง ไม่สามารถเผยแพร่ตารางได้\n' +
          pre.errors.concat(check.errors).map(function (e, i) { return (i + 1) + '. ' + e.message; }).join('\n'), pre.errors.concat(check.errors));
      }
      var prev = slotsOf(termId, function (m) { return m.status === 'เผยแพร่แล้ว'; });
      if (prev.length && prev[0].effective_from > eff) throw new AppError('VALIDATION', 'วันที่เริ่มใช้ต้องไม่ก่อนฉบับที่เผยแพร่อยู่ (' + prev[0].effective_from + ')');
      Db.updateWhere('Master', function (m) { return m.term_id === termId && m.status === 'เผยแพร่แล้ว'; }, { status: 'เก็บถาวร' }, c, 'เก็บถาวรฉบับที่เผยแพร่เดิม');
      Db.updateWhere('Master', function (m) { return m.term_id === termId && m.version === v; }, { status: 'เผยแพร่แล้ว', effective_from: eff }, c, 'เผยแพร่ตารางฉบับ ' + v);
      Db.update('Terms', termId, { schedule_status: 'เผยแพร่แล้ว', published_at: Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd HH:mm') }, c);
      return { term_id: termId, version: v, effective_from: eff, message: '✅ เผยแพร่ตารางแล้ว ใช้ตั้งแต่ ' + eff };
    });
  }

  /** ตารางที่ใช้ในวันที่กำหนด: ฉบับที่เผยแพร่ล่าสุดซึ่ง "ใช้ตั้งแต่" ไม่เกินวันนั้น */
  function versionForDate(termId, isoDate) {
    var vs = versions(termId).filter(function (v) { return v.effective_from && v.effective_from <= isoDate; });
    vs.sort(function (a, b) { return a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : a.version - b.version; });
    return vs.length ? vs[vs.length - 1].version : null;
  }

  /** อ่านตาราง: which = 'published' (ค่าเริ่มต้น สำหรับทุกคน) | 'draft' (Admin) | ระบุ version (Admin) | date */
  function get(termId, opts) {
    requireTerm_(termId);
    opts = opts || {};
    var v;
    if (opts.version) v = Number(opts.version);
    else if (opts.which === 'draft') v = latestVersion(termId, 'ร่าง');
    else if (opts.date) v = versionForDate(termId, opts.date);
    else v = latestVersion(termId, 'เผยแพร่แล้ว');
    var rows = v ? slotsOf(termId, function (m) { return m.version === v; }) : [];
    return {
      term_id: termId, version: v, status: rows.length ? rows[0].status : null, effective_from: rows.length ? rows[0].effective_from : null,
      slots: rows.map(function (m) {
        return { slot_id: m.slot_id, day: m.day, period: m.period, class_id: m.class_id, subject_id: m.subject_id,
          teacher_id: m.teacher_id, co_teacher_id: m.co_teacher_id, req_id: m.req_id, source: m.source };
      }),
      locks: Db.all('Locks').filter(function (l) { return l.term_id === termId && l.status === 'ใช้งาน'; })
    };
  }

  /** แก้ฉบับร่างด้วยมือ (ข้อ 22–23): ops = [{ class_id, a:{day,period}, b:{day,period} }] → ตรวจ → บันทึกเป็นฉบับร่างใหม่ */
  function editDraft(ctx, payload) {
    var termId = requireTerm_(payload.term_id);
    var cur = get(termId, { which: 'draft' });
    if (!cur.version) throw new AppError('NOT_FOUND', 'ยังไม่มีตารางฉบับร่าง — จัดตารางอัตโนมัติก่อน');
    if (!payload.ops || !payload.ops.length) throw new AppError('VALIDATION', 'ไม่มีรายการแก้ไข');
    var slots = cur.slots;
    payload.ops.forEach(function (op) {
      var cls = op.class_id;
      var src = slots.filter(function (s) { return s.class_id === cls && s.day === Number(op.a.day) && s.period === Number(op.a.period); })[0];
      if (!src) throw new AppError('VALIDATION', 'ไม่พบคาบที่เลือก');
      if (src.source === 'ล็อก') throw new AppError('VALIDATION', 'กิจกรรมล็อกเวลาย้ายไม่ได้ — แก้ที่แผ่น "กิจกรรมล็อกเวลา"');
      var dst = slots.filter(function (s) { return s.class_id === cls && s.day === Number(op.b.day) && s.period === Number(op.b.period); })[0];
      if (dst && dst.source === 'ล็อก') throw new AppError('VALIDATION', 'สลับกับกิจกรรมล็อกเวลาไม่ได้');
      slots = ScheduleValidator.applySwap(slots, cls, op.a, op.b);
    });
    return saveDraft(ctx, { term_id: termId, slots: slots, reason: payload.reason || 'แก้ตารางด้วยมือ (จากฉบับร่าง ' + cur.version + ')' });
  }

  /** ช่องที่สลับได้สำหรับคาบที่เลือกในฉบับร่างล่าสุด */
  function swapOptions(payload) {
    var termId = requireTerm_(payload.term_id);
    var cur = get(termId, { which: 'draft' });
    if (!cur.version) throw new AppError('NOT_FOUND', 'ยังไม่มีตารางฉบับร่าง');
    return ScheduleValidator.swapOptions(Db.loadData(), termId, cur.slots, payload.class_id, payload.day, payload.period);
  }

  return { editDraft: editDraft, swapOptions: swapOptions, generateDraft: generateDraft, saveDraft: saveDraft, checkAll: checkAll, publish: publish, get: get, versions: versions, versionForDate: versionForDate };
})();
