/**
 * Admin.gs — งานของ Admin ฝั่งเซิร์ฟเวอร์ (Phase 4)
 *
 * ทุกฟังก์ชันรับ ctx จาก Auth.requireAdmin() และทำงานภายใน Db.withLock()
 * ไม่มีฟังก์ชันใดเปลี่ยนจำนวนคาบ ครู หรือวิชาเอง — ทำตามที่ Admin ส่งมาเท่านั้น
 */

var Admin = (function () {

  function assertEditable(table) {
    if (ADMIN_EDITABLE.indexOf(table) < 0) throw new AppError('FORBIDDEN', 'แก้ไขแผ่นงานนี้ผ่านหน้า Admin ไม่ได้');
  }

  function withCtx(ctx, payload) {
    return {
      user: ctx.user,
      reason: payload && payload.reason ? String(payload.reason).slice(0, 500) : '',
      unlockReason: payload && payload.unlockReason ? String(payload.unlockReason).slice(0, 500) : ''
    };
  }

  /** แก้โครงสร้างของภาคเรียนที่เผยแพร่ตารางแล้ว → ตารางต้องตรวจสอบใหม่ (ไม่ลบตารางเดิม) */
  function markNeedsReview(table, rec, c) {
    if (STRUCTURE_TABLES.indexOf(table) < 0 || !rec || !rec.term_id) return;
    var t = Db.get('Terms', rec.term_id);
    if (t && t.schedule_status === 'เผยแพร่แล้ว') {
      Db.update('Terms', t.term_id, { schedule_status: 'ต้องตรวจสอบใหม่' },
        { user: c.user, reason: 'โครงสร้างคาบเปลี่ยน (' + schemaOf(table).sheet + ')', unlockReason: c.unlockReason });
    }
  }

  /** เพิ่มหรือแก้ไขหนึ่งรายการ: payload = { table, record, reason?, unlockReason? } */
  function save(ctx, payload) {
    var table = payload && payload.table;
    assertEditable(table);
    var rec = payload.record || {};
    var c = withCtx(ctx, payload);
    return Db.withLock(function () {
      var def = schemaOf(table);
      var id = rec[def.key];
      if (table === 'Terms' && rec.is_current !== undefined) {
        throw new AppError('VALIDATION', 'เปลี่ยนภาคเรียนปัจจุบันด้วยคำสั่ง "ตั้งเป็นภาคเรียนปัจจุบัน" เท่านั้น');
      }
      if (table === 'Settings' && id === 'current_term_id') {
        throw new AppError('VALIDATION', 'เปลี่ยนภาคเรียนปัจจุบันด้วยคำสั่ง "ตั้งเป็นภาคเรียนปัจจุบัน" เท่านั้น');
      }
      if (table === 'Calendar') {
        if (!Rules.isIsoDate(String(rec.date || ''))) throw new AppError('VALIDATION', 'วันที่ไม่ถูกต้อง (ใช้รูปแบบ ปปปป-ดด-วว)');
        var tt = Rules.termForDate(Db.all('Terms'), rec.date);
        if (!rec.term_id) rec.term_id = tt ? tt.term_id : '';
        if (rec.is_school_day === undefined) rec.is_school_day = rec.day_type === 'วันเรียนปกติ';
      }
      var saved;
      if (id && Db.get(table, id)) {
        var patch = {};
        Object.keys(rec).forEach(function (k) { if (k !== def.key) patch[k] = rec[k]; });
        saved = Db.update(table, id, patch, c);
      } else {
        if (table === 'Terms') {
          rec.term_id = rec.year + '-' + rec.semester;
          if (rec.status === undefined) rec.status = 'อนาคต';
          if (rec.schedule_status === undefined) rec.schedule_status = 'ยังไม่จัด';
        }
        if (table === 'Periods' && !rec.period_id) rec.period_id = rec.term_id + '-' + rec.period_no;
        saved = Db.insert(table, rec, c);
      }
      if (table === 'Requirements' || table === 'TeacherBlocks') {
        // ตรวจรูปแบบ วัน/คาบ ทันที
        Rules.parseNumList(saved.allowed_days); Rules.parseNumList(saved.allowed_periods);
      }
      markNeedsReview(table, saved, c);
      return saved;
    });
  }

  /** ลบหนึ่งรายการ: payload = { table, id, reason } — ตารางหลักใช้การปิดสถานะแทนการลบ */
  function remove(ctx, payload) {
    var table = payload && payload.table;
    assertEditable(table);
    if (NO_DELETE.indexOf(table) >= 0) throw new AppError('FORBIDDEN', 'ห้ามลบข้อมูลในแผ่นงานนี้ ให้เปลี่ยนสถานะเป็น "ไม่ใช้งาน" แทน');
    if (!payload.reason) throw new AppError('VALIDATION', 'กรุณาระบุเหตุผลการลบ');
    var c = withCtx(ctx, payload);
    return Db.withLock(function () {
      var old = Db.get(table, payload.id);
      if (!old) throw new AppError('NOT_FOUND', 'ไม่พบรายการ ' + payload.id);
      if (table === 'Requirements') {
        var used = Db.all('Master').some(function (m) { return m.req_id === payload.id && m.status !== 'เก็บถาวร'; });
        if (used) throw new AppError('IN_USE', 'โครงสร้างนี้ถูกใช้ในตาราง Master แล้ว ให้ปิดสถานะเป็น "ไม่ใช้งาน" แทน');
      }
      Db.remove(table, payload.id, c);
      markNeedsReview(table, old, c);
      return true;
    });
  }

  /** ตั้งภาคเรียนปัจจุบัน — มีได้ภาคเดียว และอัปเดตค่าในแผ่น "ตั้งค่าระบบ" ให้ตรงกัน */
  function setCurrentTerm(ctx, payload) {
    var c = withCtx(ctx, payload);
    return Db.withLock(function () {
      var target = Db.get('Terms', payload.term_id);
      if (!target) throw new AppError('NOT_FOUND', 'ไม่พบภาคเรียน ' + payload.term_id);
      var sys = { user: c.user, reason: c.reason || 'ตั้งภาคเรียนปัจจุบันเป็น ' + target.semester + '/' + target.year, unlockReason: 'เปลี่ยนเฉพาะสถานะภาคเรียนปัจจุบัน' };
      Db.all('Terms').forEach(function (t) {
        if (t.is_current && t.term_id !== target.term_id) Db.update('Terms', t.term_id, { is_current: false }, sys);
      });
      if (!target.is_current) Db.update('Terms', target.term_id, { is_current: true }, sys);
      Db.update('Settings', 'current_term_id', { value: target.term_id }, sys);
      return Db.get('Terms', target.term_id);
    });
  }

  /** สร้างภาคเรียนใหม่จากภาคเรียนเดิม (ข้อ 36) — ต้นทางไม่ถูกแก้ไข */
  function createTermFromTerm(ctx, payload) {
    var c = withCtx(ctx, payload);
    return Db.withLock(function () {
      var data = Db.loadData();
      var res;
      try { res = Rules.copyTermStructure(data, payload.from_term_id, payload.target || {}); }
      catch (e) { throw new AppError('VALIDATION', e.message); }
      var cc = { user: c.user, reason: c.reason || ('สร้างภาคเรียนจาก ' + payload.from_term_id) };
      if (res.term) Db.insert('Terms', res.term, cc);
      Db.insertMany('Periods', res.periods, cc, 'คัดลอกภาคเรียน');
      Db.insertMany('Requirements', res.requirements, cc, 'คัดลอกภาคเรียน');
      Db.insertMany('Locks', res.locks, cc, 'คัดลอกภาคเรียน');
      Db.insertMany('TeacherBlocks', res.blocks, cc, 'คัดลอกภาคเรียน');
      return {
        term_id: res.term_id, warnings: res.warnings,
        counts: { periods: res.periods.length, requirements: res.requirements.length, locks: res.locks.length, blocks: res.blocks.length }
      };
    });
  }

  /** อ่าน Log ล่าสุด (ใหม่สุดก่อน) */
  function getLog(ctx, payload) {
    var limit = Math.min(500, Number(payload && payload.limit) || 100);
    var term = payload && payload.term_id;
    var rows = Db.all('Log').filter(function (r) { return !term || r.term_id === term; });
    return rows.slice(-limit).reverse();
  }

  return { save: save, remove: remove, setCurrentTerm: setCurrentTerm, createTermFromTerm: createTermFromTerm, getLog: getLog };
})();
