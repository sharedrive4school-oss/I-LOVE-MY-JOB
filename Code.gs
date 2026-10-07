/**
 * Code.gs — จุดเข้าใช้งาน Web App และตัวกระจายคำขอ (API router)
 *
 * หน้าเว็บเรียกฟังก์ชันเดียว: google.script.run.api({ action, payload, token })
 * คืนค่า { ok: true, data } หรือ { ok: false, error: { code, message, details } }
 * คำสั่งกลุ่ม admin.* ตรวจ token ฝั่งเซิร์ฟเวอร์ทุกครั้ง
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('ระบบตารางสอนของโรงเรียนวัดแสนเกษม')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** แทรกไฟล์ HTML อื่น (CSS/JavaScript) ลงใน Index */
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

var PUBLIC_ACTIONS = {
  'public.bootstrap': function () { return Api.bootstrap(); },
  'public.termData': function (p) { return Api.termData(p.term_id); },
  'public.periodSummary': function (p) { return Rules.periodSummary(Db.loadData(), requireTerm_(p.term_id)); },
  'public.describeDate': function (p) { return Rules.describeDate(Db.loadData(), String(p.date || '')); },
  // ครูทั่วไปเห็นเฉพาะตารางที่เผยแพร่แล้ว (หรือฉบับที่ใช้ในวันที่ระบุ)
  'public.dashboard': function () { return Web.dashboard(false); },
  'public.pdf': function (p) { return Print.pdf(p); },
  'public.daily': function (p) { return Daily.get(String(p.date || ''), p.teacher_id || null, false); },
  'public.absences': function (p) { return Absence.list(p.from || '', p.to || '', false); },
  'public.subReport': function (p) { return Substitute.report(p.term_id); },
  'public.master': function (p) { return Master.get(p.term_id, p.date ? { date: String(p.date) } : { which: 'published' }); },
  'auth.login': function (p) { return Auth.login(p.username, p.password); },
  'auth.logout': function (p, token) { return Auth.logout(token); }
};

var ADMIN_ACTIONS = {
  'admin.whoami': function (p, ctx) { return ctx; },
  'admin.dashboard': function () { return Web.dashboard(true); },
  'admin.schema': function () { return Web.schema(); },
  'admin.table': function (p) { return Web.table(p); },
  'admin.draft': function (p) { return Web.draftWithCheck(requireTerm_(p.term_id)); },
  'admin.save': function (p, ctx) { return Admin.save(ctx, p); },
  'admin.delete': function (p, ctx) { return Admin.remove(ctx, p); },
  'admin.setCurrentTerm': function (p, ctx) { return Admin.setCurrentTerm(ctx, p); },
  'admin.createTermFromTerm': function (p, ctx) { return Admin.createTermFromTerm(ctx, p); },
  'admin.preChecks': function (p) { return Rules.preScheduleChecks(Db.loadData(), requireTerm_(p.term_id)); },
  'admin.log': function (p, ctx) { return Admin.getLog(ctx, p); },
  'admin.backupNow': function (p, ctx) { return Backup.backupNow(ctx); },
  'admin.generateSchedule': function (p, ctx) { return Master.generateDraft(ctx, p); },
  'admin.generateAndSave': function (p, ctx) {
    var g = Master.generateDraft(ctx, p);
    var saved = Master.saveDraft(ctx, { term_id: p.term_id, slots: g.slots, reason: 'จัดตารางอัตโนมัติ' });
    saved.notes = g.notes; saved.stats = g.stats; return saved;
  },
  'admin.saveDraft': function (p, ctx) { return Master.saveDraft(ctx, p); },
  'admin.checkAll': function (p, ctx) { return Master.checkAll(ctx, p); },
  'admin.publish': function (p, ctx) { return Master.publish(ctx, p); },
  'admin.master': function (p) { return Master.get(p.term_id, { which: p.which || 'draft', version: p.version }); },
  'admin.versions': function (p) { return Master.versions(requireTerm_(p.term_id)); },
  'admin.swapOptions': function (p) { return Master.swapOptions(p); },
  'admin.editDraft': function (p, ctx) { return Master.editDraft(ctx, p); },
  'admin.dailyChange': function (p, ctx) { return Daily.saveChange(ctx, p); },
  'admin.cancelDailyChange': function (p, ctx) { return Daily.cancelChange(ctx, p); },
  'admin.daily': function (p) { return Daily.get(String(p.date || ''), p.teacher_id || null, true); },
  'admin.saveAbsence': function (p, ctx) { return Absence.save(ctx, p); },
  'admin.cancelAbsence': function (p, ctx) { return Absence.cancel(ctx, p); },
  'admin.absences': function (p) { return Absence.list(p.from || '', p.to || '', true); },
  'admin.pendingSubs': function (p) { return Substitute.pending(String(p.date || '')); },
  'admin.suggestSub': function (p) { return Substitute.suggest(p); },
  'admin.confirmSub': function (p, ctx) { return Substitute.confirm(ctx, p); },
  'admin.cancelSub': function (p, ctx) { return Substitute.cancel(ctx, p); }
};

function requireTerm_(termId) {
  if (!termId || !Db.get('Terms', termId)) throw new AppError('NOT_FOUND', 'ไม่พบภาคเรียน ' + termId);
  return termId;
}

/** ฟังก์ชันเดียวที่หน้าเว็บเรียก */
function api(req) {
  req = req || {};
  var action = String(req.action || '');
  var payload = req.payload || {};
  try {
    if (PUBLIC_ACTIONS[action]) return { ok: true, data: PUBLIC_ACTIONS[action](payload, req.token) };
    if (ADMIN_ACTIONS[action]) {
      var ctx = Auth.requireAdmin(req.token);
      return { ok: true, data: ADMIN_ACTIONS[action](payload, ctx) };
    }
    throw new AppError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่ง ' + action);
  } catch (err) {
    if (err && err.name === 'AppError') return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
    console.error(action, err && err.stack);
    return { ok: false, error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ: ' + (err && err.message ? err.message : err) } };
  }
}

/** ข้อมูลสาธารณะ — ไม่มีรหัสผ่านหรือข้อมูลส่วนตัว */
var Api = (function () {
  function bootstrap() {
    var data = Db.loadData();
    var settings = {};
    data.settings.forEach(function (s) { settings[s.key] = s.value; });
    var current = data.terms.filter(function (t) { return t.is_current; });
    var currentId = current.length ? current[0].term_id : settings.current_term_id;
    return {
      app_version: APP_VERSION,
      school_name: settings.school_name, affiliation: settings.affiliation,
      system_name: settings.system_name, system_name_internal: settings.system_name_internal,
      current_term_id: currentId,
      settings_term_mismatch: current.length === 1 && settings.current_term_id !== current[0].term_id,
      today: Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd'),
      terms: data.terms.map(function (t) {
        return { term_id: t.term_id, year: t.year, semester: t.semester, start_date: t.start_date, end_date: t.end_date,
          status: t.status, is_current: t.is_current, schedule_status: t.schedule_status };
      }),
      classes: data.classes.filter(function (c) { return c.status === 'ใช้งาน'; }),
      teachers: data.teachers.map(function (t) {
        return { teacher_id: t.teacher_id, name: t.name, short_name: t.short_name, name_en: t.name_en, type: t.type, status: t.status };
      }),
      subjects: data.subjects,
      days: DAY_NAMES
    };
  }

  function termData(termId) {
    requireTerm_(termId);
    var data = Db.loadData();
    var f = function (list) { return list.filter(function (x) { return x.term_id === termId; }); };
    return {
      term_id: termId,
      periods: f(data.periods).sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; }),
      requirements: f(data.requirements),
      locks: f(data.locks),
      blocks: f(data.blocks),
      summary: Rules.periodSummary(data, termId),
      loads: Rules.teacherLoads(data, termId)
    };
  }

  return { bootstrap: bootstrap, termData: termData };
})();
