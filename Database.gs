/**
 * Database.gs — อ่าน/เขียน Google Sheets (Single Source of Truth) + Log การแก้ไข
 *
 * กติกา:
 *  - ทุกการเขียนต้องผ่าน Db.insert / Db.update / Db.remove ซึ่งตรวจข้อมูลและบันทึก Log เสมอ
 *  - การเขียนต้องอยู่ใน Db.withLock() เพื่อกัน Admin สองคนบันทึกชนกัน
 *  - ภาคเรียนที่ "สิ้นสุด" แก้ไม่ได้ เว้นแต่ส่ง ctx.unlockReason (ถูกบันทึกใน Log)
 */

var Db = (function () {
  var _cache = {};
  var _ss = null;

  function spreadsheet() {
    if (_ss) return _ss;
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!_ss) throw new AppError('CONFIG', 'ไม่พบไฟล์ฐานข้อมูล กรุณาเปิด Google Sheets แล้วเลือกเมนู "ระบบตารางสอน > ตั้งค่าครั้งแรก"');
    return _ss;
  }

  function sheetOf(table) {
    var def = schemaOf(table);
    var sh = spreadsheet().getSheetByName(def.sheet);
    if (!sh) throw new AppError('CONFIG', 'ไม่พบแผ่นงาน "' + def.sheet + '" กรุณารันเมนู "ตั้งค่าครั้งแรก"');
    return sh;
  }

  function parseCell(c, v) {
    v = v === null || v === undefined ? '' : String(v).trim();
    if (c.type === 'bool') return v.toUpperCase() === 'TRUE';
    if (c.type === 'int') {
      if (v === '') return null;
      var n = Number(v);
      return isNaN(n) ? v : n;
    }
    return v;
  }

  function toCell(c, v) {
    if (c.type === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
    if (v === null || v === undefined) return '';
    if (c.type === 'json' && typeof v !== 'string') return JSON.stringify(v);
    return String(v);
  }

  function checkKeys(table, sh) {
    var def = schemaOf(table);
    var keys = sh.getRange(KEY_ROW, 1, 1, def.cols.length).getDisplayValues()[0];
    for (var i = 0; i < def.cols.length; i++) {
      if (keys[i] !== def.cols[i].k) {
        throw new AppError('CONFIG', 'คอลัมน์ในแผ่นงาน "' + def.sheet + '" ถูกย้ายหรือแก้ไข (คอลัมน์ที่ ' + (i + 1) +
          ' ควรเป็น ' + def.cols[i].k + ' แต่พบ "' + keys[i] + '") — ห้ามแก้แถวที่ 2');
      }
    }
  }

  /** อ่านทั้งตารางเป็น array ของ object (แคชต่อการเรียก 1 ครั้ง) */
  function all(table) {
    if (_cache[table]) return _cache[table];
    var def = schemaOf(table);
    var sh = sheetOf(table);
    checkKeys(table, sh);
    var last = sh.getLastRow();
    var out = [];
    if (last >= DATA_START_ROW) {
      var rows = sh.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, def.cols.length).getDisplayValues();
      rows.forEach(function (r, i) {
        if (r.every(function (v) { return String(v).trim() === ''; })) return;
        var o = {};
        def.cols.forEach(function (c, j) { o[c.k] = parseCell(c, r[j]); });
        Object.defineProperty(o, '_row', { value: DATA_START_ROW + i, enumerable: false });
        out.push(o);
      });
    }
    _cache[table] = out;
    return out;
  }

  function get(table, id) {
    var key = schemaOf(table).key;
    var list = all(table);
    for (var i = 0; i < list.length; i++) if (list[i][key] === id) return list[i];
    return null;
  }

  /** สำหรับการทดสอบ: ชี้ไปยังสำเนาไฟล์ (null = กลับไปไฟล์จริง) */
  function useSpreadsheet(ss) { _ss = ss || null; _cache = {}; }

  function invalidate(table) { if (table) delete _cache[table]; else _cache = {}; }

  /** ตรวจข้อมูลหนึ่งรายการตาม SCHEMA: ช่องบังคับ ชนิดข้อมูล ค่าในรายการ คีย์ซ้ำ และการอ้างอิง */
  function validate(table, rec, isUpdate) {
    var def = schemaOf(table);
    var problems = [];
    def.cols.forEach(function (c) {
      var v = rec[c.k];
      var empty = v === null || v === undefined || String(v).trim() === '';
      if (c.required && empty) { problems.push('ต้องกรอก "' + c.label + '"'); return; }
      if (empty) return;
      if (c.type === 'int') {
        if (!/^-?\d+$/.test(String(v))) problems.push('"' + c.label + '" ต้องเป็นจำนวนเต็ม');
        else {
          if (c.min !== undefined && Number(v) < c.min) problems.push('"' + c.label + '" ต้องไม่น้อยกว่า ' + c.min);
          if (c.max !== undefined && Number(v) > c.max) problems.push('"' + c.label + '" ต้องไม่เกิน ' + c.max);
        }
      }
      if (c.type === 'date' && !Rules.isIsoDate(String(v))) problems.push('"' + c.label + '" ต้องเป็นวันที่รูปแบบ ปปปป-ดด-วว (ค.ศ.)');
      if (c.type === 'time' && !/^\d{2}:\d{2}$/.test(String(v))) problems.push('"' + c.label + '" ต้องเป็นเวลารูปแบบ ชช:นน');
      if (c.type === 'list') { try { Rules.parseNumList(v); } catch (e) { problems.push('"' + c.label + '" ' + e.message); } }
      if (c.enumOf && ENUMS[c.enumOf].indexOf(String(v)) < 0) problems.push('"' + c.label + '" ต้องเป็นหนึ่งใน: ' + ENUMS[c.enumOf].join(', '));
    });
    if (!isUpdate && get(table, rec[def.key])) problems.push('รหัส ' + rec[def.key] + ' มีอยู่แล้วในแผ่นงาน "' + def.sheet + '"');
    var refs = def.refs || {};
    Object.keys(refs).forEach(function (k) {
      var v = rec[k];
      if (v === null || v === undefined || v === '') return;
      if (!get(refs[k], String(v))) problems.push('"' + labelOf(def, k) + '" อ้างถึง ' + v + ' ซึ่งไม่มีในแผ่นงาน "' + schemaOf(refs[k]).sheet + '"');
    });
    if (problems.length) throw new AppError('VALIDATION', 'ไม่สามารถบันทึกได้: ' + problems.join(' • '), problems);
  }

  function labelOf(def, k) {
    for (var i = 0; i < def.cols.length; i++) if (def.cols[i].k === k) return def.cols[i].label;
    return k;
  }

  /** ห้ามแก้ข้อมูลของภาคเรียนที่สิ้นสุดแล้ว เว้นแต่ระบุเหตุผลปลดล็อก */
  function guardTerm(rec, ctx) {
    if (!rec || !rec.term_id) return;
    var t = get('Terms', rec.term_id);
    if (t && t.status === 'สิ้นสุด' && !(ctx && ctx.unlockReason)) {
      throw new AppError('TERM_LOCKED', 'ภาคเรียน ' + t.semester + '/' + t.year + ' สิ้นสุดแล้ว แก้ไขได้เมื่อระบุเหตุผลการปลดล็อกเท่านั้น');
    }
  }

  function writeRow(table, rowIndex, rec) {
    var def = schemaOf(table);
    var sh = sheetOf(table);
    if (rowIndex > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
    var range = sh.getRange(rowIndex, 1, 1, def.cols.length);
    range.setNumberFormats([def.cols.map(function (c) { return c.type === 'bool' ? 'General' : '@'; })]);
    // ใส่ checkbox ก่อน เพราะ insertCheckboxes() รีเซ็ตค่าเป็น FALSE
    def.cols.forEach(function (c, i) {
      if (c.type === 'bool') sh.getRange(rowIndex, i + 1).insertCheckboxes();
    });
    range.setValues([def.cols.map(function (c) { return toCell(c, rec[c.k]); })]);
  }

  function clean(rec) {
    var o = {};
    if (!rec) return null;
    Object.keys(rec).forEach(function (k) { o[k] = rec[k]; });
    return o;
  }

  function insert(table, obj, ctx) {
    var def = schemaOf(table);
    var rec = {};
    def.cols.forEach(function (c) { rec[c.k] = obj[c.k] === undefined ? (c.type === 'bool' ? false : '') : obj[c.k]; });
    if (!rec[def.key] && def.idPrefix) {
      rec[def.key] = Rules.nextId(def.idPrefix, all(table).map(function (r) { return r[def.key]; }), def.idWidth);
    }
    validate(table, rec, false);
    guardTerm(rec, ctx);
    var sh = sheetOf(table);
    writeRow(table, Math.max(sh.getLastRow() + 1, DATA_START_ROW), rec);
    invalidate(table);
    log(ctx, 'เพิ่ม', table, rec[def.key], null, rec);
    return rec;
  }

  function update(table, id, patch, ctx) {
    var def = schemaOf(table);
    var old = get(table, id);
    if (!old) throw new AppError('NOT_FOUND', 'ไม่พบรหัส ' + id + ' ในแผ่นงาน "' + def.sheet + '"');
    if (patch[def.key] !== undefined && patch[def.key] !== id) throw new AppError('VALIDATION', 'ห้ามเปลี่ยนรหัส ' + id);
    var rec = clean(old);
    Object.keys(patch).forEach(function (k) { if (k in rec) rec[k] = patch[k]; });
    validate(table, rec, true);
    guardTerm(old, ctx);
    guardTerm(rec, ctx);
    var changedOld = {}, changedNew = {};
    def.cols.forEach(function (c) {
      if (String(toCell(c, old[c.k])) !== String(toCell(c, rec[c.k]))) { changedOld[c.k] = old[c.k]; changedNew[c.k] = rec[c.k]; }
    });
    if (!Object.keys(changedNew).length) return rec;
    writeRow(table, old._row, rec);
    invalidate(table);
    log(ctx, 'แก้ไข', table, id, changedOld, changedNew, rec.term_id);
    return rec;
  }

  function remove(table, id, ctx) {
    var def = schemaOf(table);
    var old = get(table, id);
    if (!old) throw new AppError('NOT_FOUND', 'ไม่พบรหัส ' + id + ' ในแผ่นงาน "' + def.sheet + '"');
    guardTerm(old, ctx);
    sheetOf(table).deleteRow(old._row);
    invalidate(table);
    log(ctx, 'ลบ', table, id, clean(old), null);
    return true;
  }

  /** เขียนหลายแถวพร้อมกัน (ใช้ตอนนำเข้าข้อมูลครั้งแรกและคัดลอกภาคเรียน) — ตรวจทุกแถวก่อนเขียน */
  function insertMany(table, objs, ctx, logAction) {
    if (!objs.length) return [];
    var def = schemaOf(table);
    var ids = all(table).map(function (r) { return r[def.key]; });
    var recs = objs.map(function (obj) {
      var rec = {};
      def.cols.forEach(function (c) { rec[c.k] = obj[c.k] === undefined ? (c.type === 'bool' ? false : '') : obj[c.k]; });
      if (!rec[def.key] && def.idPrefix) { rec[def.key] = Rules.nextId(def.idPrefix, ids, def.idWidth); }
      if (ids.indexOf(rec[def.key]) >= 0 && obj[def.key]) throw new AppError('VALIDATION', 'รหัส ' + rec[def.key] + ' ซ้ำในแผ่นงาน "' + def.sheet + '"');
      ids.push(rec[def.key]);
      return rec;
    });
    recs.forEach(function (rec) { validate(table, rec, true); guardTerm(rec, ctx); });
    var sh = sheetOf(table);
    var start = Math.max(sh.getLastRow() + 1, DATA_START_ROW);
    var need = start + recs.length - 1;
    if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 20);
    var range = sh.getRange(start, 1, recs.length, def.cols.length);
    var fmt = def.cols.map(function (c) { return c.type === 'bool' ? 'General' : '@'; });
    range.setNumberFormats(recs.map(function () { return fmt; }));
    def.cols.forEach(function (c, i) { if (c.type === 'bool') sh.getRange(start, i + 1, recs.length, 1).insertCheckboxes(); });
    range.setValues(recs.map(function (rec) { return def.cols.map(function (c) { return toCell(c, rec[c.k]); }); }));
    invalidate(table);
    log(ctx, logAction || 'เพิ่มหลายรายการ', table, recs.length + ' รายการ', null,
      { ids: recs.map(function (r) { return r[def.key]; }) }, recs[0].term_id || '');
    return recs;
  }

  /**
   * แก้หลายแถวพร้อมกัน (เช่น เปลี่ยนสถานะตาราง Master ทั้งฉบับ) — เขียนครั้งเดียว บันทึก Log หนึ่งรายการ
   * predicate(rec) เลือกแถว, patch = ค่าที่จะเปลี่ยน
   */
  function updateWhere(table, predicate, patch, ctx, logAction) {
    var def = schemaOf(table);
    var rows = all(table).filter(predicate);
    if (!rows.length) return 0;
    rows.forEach(function (r) { guardTerm(r, ctx); });
    var sh = sheetOf(table);
    var colIdx = {};
    def.cols.forEach(function (c, i) { colIdx[c.k] = i; });
    Object.keys(patch).forEach(function (k) {
      if (!(k in colIdx)) throw new AppError('VALIDATION', 'ไม่รู้จักคอลัมน์ ' + k);
      var c = def.cols[colIdx[k]];
      if (c.enumOf && ENUMS[c.enumOf].indexOf(String(patch[k])) < 0) throw new AppError('VALIDATION', '"' + c.label + '" ไม่ถูกต้อง');
      // เขียนเป็นช่วงต่อเนื่องของแถวที่เลือก
      var groups = [], cur = null;
      rows.map(function (r) { return r._row; }).sort(function (a, b) { return a - b; }).forEach(function (rowNo) {
        if (cur && rowNo === cur.end + 1) cur.end = rowNo; else { cur = { start: rowNo, end: rowNo }; groups.push(cur); }
      });
      groups.forEach(function (g) {
        var n = g.end - g.start + 1, vals = [];
        for (var i = 0; i < n; i++) vals.push([toCell(c, patch[k])]);
        sh.getRange(g.start, colIdx[k] + 1, n, 1).setValues(vals);
      });
    });
    invalidate(table);
    log(ctx, logAction || 'แก้ไขหลายรายการ', table, rows.length + ' รายการ',
      { ids: rows.map(function (r) { return r[def.key]; }).slice(0, 400) }, patch, rows[0].term_id || '');
    return rows.length;
  }

  /** บันทึก Log การแก้ไข (ข้อ 45) — เขียนตรงลงแผ่นงาน ไม่ผ่าน insert เพื่อไม่วนซ้ำ */
  function log(ctx, action, table, recordId, oldV, newV, termId) {
    var def = schemaOf('Log');
    var now = new Date();
    var rec = {
      log_id: 'LOG-' + Utilities.formatDate(now, APP_TZ, 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 9000 + 1000),
      timestamp: Utilities.formatDate(now, APP_TZ, 'yyyy-MM-dd HH:mm:ss'),
      user: (ctx && ctx.user) || 'ระบบ',
      action: action,
      sheet: table === 'Log' ? '' : schemaOf(table).sheet,
      record_id: recordId === null || recordId === undefined ? '' : String(recordId),
      old_value: oldV ? JSON.stringify(oldV) : '',
      new_value: newV ? JSON.stringify(newV) : '',
      reason: [(ctx && ctx.reason) || '', (ctx && ctx.unlockReason) ? '[ปลดล็อกภาคเรียนที่สิ้นสุด] ' + ctx.unlockReason : ''].filter(Boolean).join(' '),
      term_id: termId || (newV && newV.term_id) || (oldV && oldV.term_id) || ''
    };
    var sh = sheetOf('Log');
    writeRow('Log', Math.max(sh.getLastRow() + 1, DATA_START_ROW), rec);
    delete _cache.Log;
  }

  /** ล็อกการเขียน — กันการบันทึกพร้อมกัน แล้วล้างแคชเพื่ออ่านข้อมูลล่าสุด */
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new AppError('BUSY', 'มีผู้ใช้อื่นกำลังบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
    try {
      _cache = {};
      return fn();
    } finally {
      SpreadsheetApp.flush();
      lock.releaseLock();
    }
  }

  /** โหลดข้อมูลหลักทั้งหมดในรูปแบบที่ Rules ใช้ */
  function loadData() {
    return {
      settings: all('Settings'), terms: all('Terms'), classes: all('Classes'), periods: all('Periods'),
      teachers: all('Teachers'), subjects: all('Subjects'), teacherSubjects: all('TeacherSubjects'),
      requirements: all('Requirements'), locks: all('Locks'), blocks: all('TeacherBlocks'), calendar: all('Calendar')
    };
  }

  return {
    spreadsheet: spreadsheet, useSpreadsheet: useSpreadsheet, sheetOf: sheetOf, all: all, get: get, invalidate: invalidate, validate: validate,
    insert: insert, update: update, remove: remove, insertMany: insertMany, updateWhere: updateWhere, log: log, withLock: withLock, loadData: loadData
  };
})();
