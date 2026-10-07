/**
 * Config.gs — ค่าคงที่และโครงสร้างฐานข้อมูล (Schema)
 * ระบบตารางสอนของโรงเรียนวัดแสนเกษม
 *
 * ไฟล์นี้กำหนด "รูปร่าง" ของข้อมูลเท่านั้น
 * ห้ามใส่รายชื่อครู วิชา ปีการศึกษา หรือภาคเรียนในไฟล์นี้ — ข้อมูลจริงอยู่ใน Google Sheets
 */

var APP_VERSION = '0.4.0 (Phase 2–4)';
var APP_TZ = 'Asia/Bangkok';

/** แถวหัวตาราง: แถว 1 = ชื่อภาษาไทย, แถว 2 = รหัสคอลัมน์ที่โค้ดใช้, ข้อมูลเริ่มแถว 3 */
var LABEL_ROW = 1;
var KEY_ROW = 2;
var DATA_START_ROW = 3;

var DAY_NAMES = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' };

var ENUMS = {
  ACTIVE: ['ใช้งาน', 'ไม่ใช้งาน'],
  TERM_STATUS: ['อนาคต', 'ปัจจุบัน', 'สิ้นสุด'],
  SCHEDULE_STATUS: ['ยังไม่จัด', 'ร่าง', 'เผยแพร่แล้ว', 'ต้องตรวจสอบใหม่'],
  TEACHER_TYPE: ['ครูประจำ', 'ครูต่างชาติ', 'ครูภายนอก', 'พระวิทยากร'],
  SUBJECT_CATEGORY: ['วิชาหลัก', 'วิชาพื้นฐาน', 'วิชาเพิ่มเติม', 'กิจกรรม'],
  PERIOD_TYPE: ['คาบเรียน', 'พัก'],
  SESSION: ['เช้า', 'บ่าย'],
  SLOT_SOURCE: ['อัตโนมัติ', 'แก้มือ', 'ล็อก'],
  SLOT_STATUS: ['ร่าง', 'เผยแพร่แล้ว', 'เก็บถาวร'],
  CHANGE_TYPE: ['สอนแทน', 'ยกเลิกคาบ', 'สลับคาบ', 'กิจกรรมพิเศษ'],
  ABSENCE_TYPE: ['ลาป่วย', 'ลากิจ', 'ลาพักผ่อน', 'อบรม', 'ไปราชการ', 'ติดภารกิจ', 'อื่น ๆ'],
  RECORD_STATUS: ['ใช้งาน', 'ยกเลิก'],
  SUB_ROLE: ['ผู้สอน', 'ผู้ประกบ'],
  SUB_STATUS: ['ยืนยันแล้ว', 'ยกเลิก'],
  DAY_TYPE: ['วันเรียนปกติ', 'วันหยุดราชการ', 'วันหยุดพิเศษ', 'ประชุม', 'อบรม', 'กิจกรรมโรงเรียน', 'วันสอบ', 'ปิดภาคเรียน', 'อื่น ๆ'],
  LEVEL: ['ผิด', 'เตือน', 'ผ่าน']
};

/** สร้างนิยามคอลัมน์: k = รหัส, label = ชื่อไทย, type = str|int|bool|date|time|json|list */
function col_(k, label, type, opts) {
  var c = { k: k, label: label, type: type || 'str' };
  if (opts) for (var p in opts) c[p] = opts[p];
  return c;
}

/**
 * SCHEMA — 17 แผ่นงาน
 * key = คอลัมน์คีย์หลัก, idPrefix/idWidth = รูปแบบรหัสอัตโนมัติ, refs = คีย์อ้างอิงไปตารางอื่น
 */
var SCHEMA = {
  Settings: {
    sheet: 'ตั้งค่าระบบ', key: 'key',
    cols: [col_('key', 'รหัสค่า', 'str', { required: true }), col_('value', 'ค่า'), col_('description', 'คำอธิบาย')]
  },
  Terms: {
    sheet: 'ปีการศึกษา_ภาคเรียน', key: 'term_id',
    cols: [
      col_('term_id', 'รหัสภาคเรียน (ปี-ภาค)', 'str', { required: true }),
      col_('year', 'ปีการศึกษา (พ.ศ.)', 'int', { required: true }),
      col_('semester', 'ภาคเรียน', 'int', { required: true }),
      col_('start_date', 'วันเปิดภาค (ปปปป-ดด-วว ค.ศ.)', 'date'),
      col_('end_date', 'วันปิดภาค (ปปปป-ดด-วว ค.ศ.)', 'date'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'TERM_STATUS' }),
      col_('is_current', 'ภาคเรียนปัจจุบัน', 'bool'),
      col_('schedule_status', 'สถานะตาราง', 'str', { enumOf: 'SCHEDULE_STATUS' }),
      col_('published_at', 'เผยแพร่เมื่อ'),
      col_('note', 'หมายเหตุ')
    ]
  },
  Classes: {
    sheet: 'ระดับชั้น', key: 'class_id',
    cols: [
      col_('class_id', 'รหัสชั้น', 'str', { required: true }),
      col_('name', 'ชื่อชั้น', 'str', { required: true }),
      col_('sort_order', 'ลำดับ', 'int'),
      col_('in_timetable', 'อยู่ในตารางสอน', 'bool'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'ACTIVE' })
    ]
  },
  Periods: {
    sheet: 'เวลาเรียน', key: 'period_id', refs: { term_id: 'Terms' },
    cols: [
      col_('period_id', 'รหัส', 'str', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('period_no', 'คาบที่ (พัก = 0)', 'int', { required: true }),
      col_('start_time', 'เริ่ม (ชช:นน)', 'time', { required: true }),
      col_('end_time', 'สิ้นสุด (ชช:นน)', 'time', { required: true }),
      col_('type', 'ประเภท', 'str', { required: true, enumOf: 'PERIOD_TYPE' }),
      col_('session', 'ช่วง', 'str', { enumOf: 'SESSION' }),
      col_('label', 'ป้ายแสดงผล')
    ]
  },
  Teachers: {
    sheet: 'รายชื่อครู', key: 'teacher_id', idPrefix: 'T', idWidth: 2,
    cols: [
      col_('teacher_id', 'รหัสครู', 'str', { required: true }),
      col_('name', 'ชื่อ-สกุล', 'str', { required: true }),
      col_('short_name', 'ชื่อที่แสดงในตาราง', 'str', { required: true }),
      col_('name_en', 'ชื่อภาษาอังกฤษ'),
      col_('type', 'ประเภทครู', 'str', { required: true, enumOf: 'TEACHER_TYPE' }),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'ACTIVE' }),
      col_('note', 'หมายเหตุ')
    ]
  },
  Subjects: {
    sheet: 'รายวิชา', key: 'subject_id', idPrefix: 'S', idWidth: 2,
    cols: [
      col_('subject_id', 'รหัสวิชา', 'str', { required: true }),
      col_('name', 'ชื่อวิชา/กิจกรรม', 'str', { required: true }),
      col_('category', 'ประเภท', 'str', { required: true, enumOf: 'SUBJECT_CATEGORY' }),
      col_('is_core', 'วิชาหลัก (ควรอยู่ช่วงเช้า)', 'bool'),
      col_('semester_only', 'ใช้เฉพาะภาคเรียน (ว่าง = ทุกภาค)', 'int'),
      col_('color', 'สี (#RRGGBB)'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'ACTIVE' })
    ]
  },
  TeacherSubjects: {
    sheet: 'ความสามารถครู', key: 'ts_id', idPrefix: 'TS', idWidth: 3,
    refs: { teacher_id: 'Teachers', subject_id: 'Subjects' },
    cols: [
      col_('ts_id', 'รหัส', 'str', { required: true }),
      col_('teacher_id', 'ครู', 'str', { required: true }),
      col_('subject_id', 'วิชาที่สอนได้', 'str', { required: true })
    ]
  },
  Requirements: {
    sheet: 'โครงสร้างคาบเรียน', key: 'req_id', idPrefix: 'R', idWidth: 4,
    refs: { term_id: 'Terms', class_id: 'Classes', subject_id: 'Subjects', teacher_id: 'Teachers', co_teacher_id: 'Teachers' },
    cols: [
      col_('req_id', 'รหัส', 'str', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('class_id', 'ชั้น', 'str', { required: true }),
      col_('subject_id', 'วิชา', 'str', { required: true }),
      col_('periods', 'จำนวนคาบ/สัปดาห์', 'int', { required: true, min: 1 }),
      col_('teacher_id', 'ครูผู้สอน (ว่างได้เฉพาะกิจกรรมรวม)'),
      col_('co_teacher_id', 'ครูประกบ/ร่วมสอน'),
      col_('priority', 'ลำดับความสำคัญ (1 = สูงสุด)', 'int'),
      col_('allowed_days', 'วันที่จัดได้ (เช่น 1-5 หรือ 3)', 'list'),
      col_('allowed_periods', 'คาบที่จัดได้ (เช่น 1-3)', 'list'),
      col_('group_id', 'รหัสกิจกรรมรวม'),
      col_('note', 'หมายเหตุ'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'ACTIVE' })
    ]
  },
  Locks: {
    sheet: 'กิจกรรมล็อกเวลา', key: 'lock_id', idPrefix: 'L', idWidth: 3,
    refs: { term_id: 'Terms', subject_id: 'Subjects' },
    cols: [
      col_('lock_id', 'รหัส', 'str', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('subject_id', 'กิจกรรม', 'str', { required: true }),
      col_('group_id', 'รหัสกิจกรรมรวม', 'str', { required: true }),
      col_('day', 'วัน (1=จันทร์ … 5=ศุกร์)', 'int', { required: true, min: 1, max: 7 }),
      col_('period', 'คาบ', 'int', { required: true, min: 1 }),
      col_('class_ids', 'ชั้นที่ใช้ (คั่นด้วย ,)', 'str', { required: true }),
      col_('teacher_ids', 'ครูที่ถูกจองเวลา (คั่นด้วย ,)'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'ACTIVE' })
    ]
  },
  TeacherBlocks: {
    sheet: 'ครูไม่ว่างประจำ', key: 'block_id', idPrefix: 'B', idWidth: 3,
    refs: { term_id: 'Terms', teacher_id: 'Teachers' },
    cols: [
      col_('block_id', 'รหัส', 'str', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('teacher_id', 'ครู', 'str', { required: true }),
      col_('day', 'วัน (1=จันทร์ … 5=ศุกร์)', 'int', { required: true, min: 1, max: 7 }),
      col_('period_from', 'ตั้งแต่คาบ (ว่าง = ทั้งวัน)', 'int'),
      col_('period_to', 'ถึงคาบ', 'int'),
      col_('reason', 'เหตุผล')
    ]
  },
  Master: {
    sheet: 'ตารางเรียน_Master', key: 'slot_id', idPrefix: 'M', idWidth: 5,
    refs: { term_id: 'Terms', class_id: 'Classes', subject_id: 'Subjects', teacher_id: 'Teachers', co_teacher_id: 'Teachers', req_id: 'Requirements' },
    cols: [
      col_('slot_id', 'รหัส', 'str', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('version', 'ฉบับที่', 'int', { required: true }),
      col_('day', 'วัน', 'int', { required: true }),
      col_('period', 'คาบ', 'int', { required: true }),
      col_('class_id', 'ชั้น', 'str', { required: true }),
      col_('subject_id', 'วิชา', 'str', { required: true }),
      col_('teacher_id', 'ครูผู้สอน'),
      col_('co_teacher_id', 'ครูประกบ'),
      col_('req_id', 'อ้างอิงโครงสร้าง'),
      col_('source', 'ที่มา', 'str', { enumOf: 'SLOT_SOURCE' }),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'SLOT_STATUS' }),
      col_('effective_from', 'ใช้ตั้งแต่วันที่', 'date')
    ]
  },
  DailyChanges: {
    sheet: 'ตารางรายวัน', key: 'change_id', idPrefix: 'C', idWidth: 5,
    refs: { term_id: 'Terms', slot_id: 'Master', new_teacher_id: 'Teachers', new_subject_id: 'Subjects' },
    cols: [
      col_('change_id', 'รหัส', 'str', { required: true }),
      col_('date', 'วันที่', 'date', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('slot_id', 'คาบในตาราง Master'),
      col_('change_type', 'ประเภทการเปลี่ยนแปลง', 'str', { required: true, enumOf: 'CHANGE_TYPE' }),
      col_('new_teacher_id', 'ครูใหม่'),
      col_('new_subject_id', 'วิชาใหม่'),
      col_('sub_id', 'อ้างอิงการสอนแทน'),
      col_('note', 'หมายเหตุ'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'RECORD_STATUS' }),
      col_('created_by', 'บันทึกโดย'),
      col_('created_at', 'บันทึกเมื่อ')
    ]
  },
  Absences: {
    sheet: 'ครูไม่อยู่', key: 'absence_id', idPrefix: 'A', idWidth: 5,
    refs: { teacher_id: 'Teachers' },
    cols: [
      col_('absence_id', 'รหัส', 'str', { required: true }),
      col_('date', 'วันที่', 'date', { required: true }),
      col_('teacher_id', 'ครู', 'str', { required: true }),
      col_('type', 'ประเภท', 'str', { required: true, enumOf: 'ABSENCE_TYPE' }),
      col_('whole_day', 'ทั้งวัน', 'bool'),
      col_('period_from', 'ตั้งแต่คาบ', 'int'),
      col_('period_to', 'ถึงคาบ', 'int'),
      col_('note', 'หมายเหตุ'),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'RECORD_STATUS' }),
      col_('created_by', 'บันทึกโดย'),
      col_('created_at', 'บันทึกเมื่อ')
    ]
  },
  Substitutions: {
    sheet: 'จัดสอนแทน', key: 'sub_id', idPrefix: 'U', idWidth: 5,
    refs: { absence_id: 'Absences', term_id: 'Terms', slot_id: 'Master', original_teacher_id: 'Teachers', substitute_teacher_id: 'Teachers' },
    cols: [
      col_('sub_id', 'รหัส', 'str', { required: true }),
      col_('absence_id', 'อ้างอิงครูไม่อยู่', 'str', { required: true }),
      col_('date', 'วันที่', 'date', { required: true }),
      col_('term_id', 'ภาคเรียน', 'str', { required: true }),
      col_('slot_id', 'คาบในตาราง Master', 'str', { required: true }),
      col_('original_teacher_id', 'ครูเดิม', 'str', { required: true }),
      col_('substitute_teacher_id', 'ครูสอนแทน', 'str', { required: true }),
      col_('role', 'บทบาท', 'str', { required: true, enumOf: 'SUB_ROLE' }),
      col_('status', 'สถานะ', 'str', { required: true, enumOf: 'SUB_STATUS' }),
      col_('confirmed_by', 'ยืนยันโดย'),
      col_('confirmed_at', 'ยืนยันเมื่อ')
    ]
  },
  Calendar: {
    sheet: 'ปฏิทินโรงเรียน', key: 'date', refs: { term_id: 'Terms' },
    cols: [
      col_('date', 'วันที่ (ปปปป-ดด-วว ค.ศ.)', 'date', { required: true }),
      col_('term_id', 'ภาคเรียน'),
      col_('day_type', 'สถานะวัน', 'str', { required: true, enumOf: 'DAY_TYPE' }),
      col_('is_school_day', 'มีการเรียนการสอน', 'bool'),
      col_('note', 'หมายเหตุ')
    ]
  },
  Validation: {
    sheet: 'ตรวจสอบระบบ', key: 'check_id',
    cols: [
      col_('check_id', 'รหัส', 'str', { required: true }),
      col_('run_id', 'รอบการตรวจ', 'str', { required: true }),
      col_('run_at', 'ตรวจเมื่อ'),
      col_('term_id', 'ภาคเรียน'),
      col_('rule', 'กฎ'),
      col_('level', 'ระดับ', 'str', { enumOf: 'LEVEL' }),
      col_('message', 'รายละเอียด'),
      col_('ref', 'อ้างอิง')
    ]
  },
  Log: {
    sheet: 'Log การแก้ไข', key: 'log_id',
    cols: [
      col_('log_id', 'รหัส', 'str', { required: true }),
      col_('timestamp', 'วันเวลา'),
      col_('user', 'ผู้แก้ไข'),
      col_('action', 'ประเภทการแก้ไข'),
      col_('sheet', 'แผ่นงาน'),
      col_('record_id', 'รหัสรายการ'),
      col_('old_value', 'รายการเดิม', 'json'),
      col_('new_value', 'รายการใหม่', 'json'),
      col_('reason', 'เหตุผล'),
      col_('term_id', 'ภาคเรียน')
    ]
  }
};

/** ตารางที่ Admin แก้ไขผ่านหน้าเว็บได้ (Phase 4) และตารางที่ห้ามลบแถว (ใช้การเปลี่ยนสถานะแทน) */
var ADMIN_EDITABLE = ['Settings', 'Terms', 'Classes', 'Periods', 'Teachers', 'Subjects', 'TeacherSubjects',
  'Requirements', 'Locks', 'TeacherBlocks', 'Calendar'];
var NO_DELETE = ['Settings', 'Terms', 'Classes', 'Teachers', 'Subjects'];
/** การแก้ตารางเหล่านี้ทำให้ตารางที่เผยแพร่แล้วต้องตรวจสอบใหม่ */
var STRUCTURE_TABLES = ['Periods', 'Requirements', 'Locks', 'TeacherBlocks'];

function schemaOf(table) {
  var def = SCHEMA[table];
  if (!def) throw new AppError('CONFIG', 'ไม่รู้จักตาราง ' + table);
  return def;
}

/** แปลงแถว (array ตามลำดับคอลัมน์ใน SCHEMA) เป็น object — ใช้กับข้อมูลเริ่มต้น */
function rowsToObjects(table, rows) {
  var def = schemaOf(table);
  return rows.map(function (r) {
    var o = {};
    def.cols.forEach(function (c, i) {
      var v = r[i];
      if (c.type === 'bool') o[c.k] = v === true;
      else if (c.type === 'int') o[c.k] = (v === '' || v === null || v === undefined) ? null : Number(v);
      else o[c.k] = (v === null || v === undefined) ? '' : String(v);
    });
    return o;
  });
}

/** ข้อผิดพลาดของระบบ: code ใช้ให้หน้าเว็บแยกประเภท, message เป็นภาษาไทยสำหรับผู้ใช้ */
function AppError(code, message, details) {
  this.name = 'AppError';
  this.code = code;
  this.message = message;
  this.details = details || null;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;
