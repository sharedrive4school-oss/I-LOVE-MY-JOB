/**
 * Print.gs — สร้างไฟล์ PDF ขนาด A4 (Phase 12, ข้อ 43)
 *
 * รองรับ: ตารางรายชั้น, ตารางครู, ตารางภาพรวม (รายวันในสัปดาห์), ตารางรายวัน (ตามวันที่), รายงานสอนแทน
 * ไฟล์ PDF ถูกบันทึกในโฟลเดอร์ "PDF ระบบตารางสอน" ของเจ้าของ (แชร์แบบดูได้ผ่านลิงก์) และเก็บ 100 ไฟล์ล่าสุด
 */

var Print = (function () {
  var FOLDER = 'PDF ระบบตารางสอน', KEEP = 100;

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function page(title, sub, body) {
    var st = Db.get('Settings', 'school_name'), af = Db.get('Settings', 'affiliation');
    return '<html><head><meta charset="utf-8"><style>' +
      '@page{size:A4 landscape;margin:10mm}body{font-family:"Sarabun","Tahoma",sans-serif;font-size:10pt;color:#111}' +
      'h1{font-size:14pt;margin:0}h2{font-size:12pt;margin:10px 0 4px}.sub{color:#444;font-size:9pt;margin-bottom:6px}' +
      'table{border-collapse:collapse;width:100%;page-break-inside:avoid;margin-bottom:8px}th,td{border:1px solid #888;padding:3px 4px;vertical-align:top}' +
      'th{background:#E5E7EB}td.t{white-space:nowrap;width:70px}.s{font-weight:bold}.w{font-size:8.5pt;color:#333}.brk{page-break-after:always}' +
      '</style></head><body><h1>' + esc(st ? st.value : '') + ' · ' + esc(title) + '</h1><div class="sub">' + esc(af ? af.value : '') + ' · ' + esc(sub) +
      ' · พิมพ์เมื่อ ' + Utilities.formatDate(new Date(), APP_TZ, 'dd/MM/yyyy HH:mm') + '</div>' + body + '</body></html>';
  }

  function ctx(termId) {
    var data = Db.loadData();
    var m = Master.get(termId, { which: 'published' });
    if (!m.version) throw new AppError('NOT_FOUND', 'ยังไม่มีตารางที่เผยแพร่');
    var periods = data.periods.filter(function (p) { return p.term_id === termId; }).sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; });
    var map = function (list, k) { var o = {}; list.forEach(function (x) { o[x[k]] = x; }); return o; };
    var term = Db.get('Terms', termId);
    return { data: data, m: m, periods: periods, days: Rules.schoolDays(data), subj: map(data.subjects, 'subject_id'), tch: map(data.teachers, 'teacher_id'),
      cls: map(data.classes, 'class_id'), termLabel: 'ภาคเรียนที่ ' + term.semester + '/' + term.year };
  }

  function weekGrid(c, heading, cell) {
    var h = '<h2>' + esc(heading) + '</h2><table><tr><th>เวลา</th>' + c.days.map(function (d) { return '<th>' + DAY_NAMES[d] + '</th>'; }).join('') + '</tr>';
    c.periods.forEach(function (p) {
      var lab = (p.type === 'พัก' ? esc(p.label) : 'คาบ ' + p.period_no) + '<br>' + p.start_time + '–' + p.end_time;
      if (p.type === 'พัก') { h += '<tr><td class="t">' + lab + '</td><td colspan="' + c.days.length + '" style="text-align:center;background:#F3F4F6">พักกลางวัน</td></tr>'; return; }
      h += '<tr><td class="t">' + lab + '</td>' + c.days.map(function (d) { return '<td>' + cell(d, p.period_no) + '</td>'; }).join('') + '</tr>';
    });
    return h + '</table>';
  }

  function classHtml(termId, classId) {
    var c = ctx(termId);
    var list = classId && classId !== 'all' ? [classId] : Rules.periodSummary(c.data, termId).map(function (x) { return x.class_id; });
    var body = list.map(function (cid, i) {
      return weekGrid(c, 'ตารางเรียน ' + c.cls[cid].name, function (d, p) {
        var s = c.m.slots.filter(function (x) { return x.class_id === cid && x.day === d && x.period === p; })[0];
        if (!s) return '';
        var who = s.teacher_id ? c.tch[s.teacher_id].short_name + (s.co_teacher_id ? ' + ' + c.tch[s.co_teacher_id].short_name : '') : 'ครูตามกิจกรรม';
        return '<div class="s">' + esc(c.subj[s.subject_id].name) + '</div><div class="w">' + esc(who) + '</div>';
      }) + (i < list.length - 1 ? '<div class="brk"></div>' : '');
    }).join('');
    return { html: page('ตารางเรียนรายชั้น', c.termLabel + ' · ฉบับที่ ' + c.m.version, body), name: 'ตารางเรียน_' + (classId && classId !== 'all' ? c.cls[classId].name : 'ทุกชั้น') };
  }

  function teacherHtml(termId, teacherId) {
    var c = ctx(termId);
    var list = teacherId && teacherId !== 'all' ? [teacherId] : c.data.teachers.filter(function (t) { return t.status === 'ใช้งาน'; }).map(function (t) { return t.teacher_id; });
    var parts = [];
    list.forEach(function (tid) {
      var mine = c.m.slots.filter(function (s) { return s.teacher_id === tid || s.co_teacher_id === tid; });
      var locks = c.m.locks.filter(function (l) { return Rules.splitIds(l.teacher_ids).indexOf(tid) >= 0; });
      if (!mine.length && !locks.length) return;
      parts.push(weekGrid(c, 'ตารางสอน ' + c.tch[tid].name + ' (' + (mine.length + locks.length) + ' คาบ/สัปดาห์)', function (d, p) {
        var s = mine.filter(function (x) { return x.day === d && x.period === p; })[0];
        if (s) return '<div class="s">' + esc(c.subj[s.subject_id].name) + '</div><div class="w">' + esc(c.cls[s.class_id].name) + (s.co_teacher_id === tid ? ' (ประกบ)' : '') + '</div>';
        var l = locks.filter(function (x) { return x.day === d && x.period === p; })[0];
        return l ? '<div class="s">' + esc(c.subj[l.subject_id].name) + '</div><div class="w">กิจกรรมรวม</div>' : '';
      }));
    });
    return { html: page('ตารางสอนรายครู', c.termLabel + ' · ฉบับที่ ' + c.m.version, parts.join('<div class="brk"></div>')),
      name: 'ตารางสอน_' + (teacherId && teacherId !== 'all' ? c.tch[teacherId].short_name : 'ครูทุกคน') };
  }

  function overviewHtml(termId, day) {
    var c = ctx(termId);
    var days = day ? [Number(day)] : c.days;
    var tp = Rules.teachingPeriods(c.data, termId);
    var body = days.map(function (d) {
      var h = '<h2>วัน' + DAY_NAMES[d] + '</h2><table><tr><th>ครู</th>' + tp.map(function (p) { return '<th>คาบ ' + p + '</th>'; }).join('') + '</tr>';
      c.data.teachers.filter(function (t) { return t.status === 'ใช้งาน'; }).forEach(function (t) {
        var cells = tp.map(function (p) {
          var s = c.m.slots.filter(function (x) { return x.day === d && x.period === p && (x.teacher_id === t.teacher_id || x.co_teacher_id === t.teacher_id); })[0];
          if (s) return '<td>' + esc(c.cls[s.class_id].name) + ' ' + esc(c.subj[s.subject_id].name) + (s.co_teacher_id === t.teacher_id ? ' (ประกบ)' : '') + '</td>';
          var l = c.m.locks.filter(function (x) { return x.day === d && x.period === p && Rules.splitIds(x.teacher_ids).indexOf(t.teacher_id) >= 0; })[0];
          return '<td>' + (l ? esc(c.subj[l.subject_id].name) : '') + '</td>';
        });
        h += '<tr><td class="t">' + esc(t.short_name) + '</td>' + cells.join('') + '</tr>';
      });
      return h + '</table>';
    }).join('<div class="brk"></div>');
    return { html: page('ภาพรวมตารางสอนครูทั้งหมด', c.termLabel + ' · ฉบับที่ ' + c.m.version, body), name: 'ภาพรวมตารางสอน' + (day ? '_วัน' + DAY_NAMES[day] : '') };
  }

  function dailyHtml(isoDate) {
    var day = Daily.get(isoDate, null, false);
    var head = 'วัน' + day.day_name + 'ที่ ' + isoDate + ' · ' + (day.term_id ? 'ภาคเรียนที่ ' + day.semester + '/' + day.year : 'นอกภาคเรียน') + ' · ' + day.day_type;
    var body = '';
    if (day.absent.length) body += '<h2>ครูที่ไม่อยู่</h2><table><tr><th>ครู</th><th>ประเภท</th><th>ช่วงเวลา</th></tr>' +
      day.absent.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td>' + esc(a.type) + '</td><td>' + esc(a.periods) + '</td></tr>'; }).join('') + '</table>';
    if (!day.classes.length) body += '<p>ไม่มีการเรียนการสอน' + (day.note ? ' (' + esc(day.note) + ')' : '') + '</p>';
    var tp = day.periods.filter(function (p) { return p.type === 'คาบเรียน'; }).map(function (p) { return p.period_no; });
    if (day.classes.length) {
      body += '<h2>ตารางทุกชั้น</h2><table><tr><th>ชั้น</th>' + tp.map(function (p) { return '<th>คาบ ' + p + '</th>'; }).join('') + '</tr>';
      day.classes.forEach(function (c) {
        body += '<tr><td class="t">' + esc(c.name) + '</td>' + tp.map(function (p) {
          var s = c.slots.filter(function (x) { return x.period === p; })[0];
          if (!s) return '<td></td>';
          var who = s.teacher + (s.co_teacher ? ' + ' + s.co_teacher : '');
          var mark = s.status === 'ปกติ' ? '' : ' <b>[' + esc(s.status) + (s.original_teacher ? ' แทน ' + esc(s.original_teacher) : '') + ']</b>';
          return '<td><div class="s">' + esc(s.subject) + '</div><div class="w">' + esc(who) + mark + '</div></td>';
        }).join('') + '</tr>';
      });
      body += '</table>';
    }
    return { html: page('ตารางรายวัน', head, body), name: 'ตารางรายวัน_' + isoDate };
  }

  function subsHtml(termId) {
    var rep = Substitute.report(termId);
    var term = Db.get('Terms', termId);
    var body = '<table><tr><th>ครู</th><th>จำนวนครั้ง</th><th>รายละเอียด (วันที่ · คาบ · แทน · ชั้น · วิชา)</th></tr>' + rep.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td style="text-align:center">' + r.count + '</td><td>' + r.items.map(function (i) {
        return esc(i.date + ' · คาบ ' + i.period + ' · แทน ' + i.replaced + ' · ' + i.class_name + ' · ' + i.subject + (i.role === 'ผู้ประกบ' ? ' (ประกบ)' : ''));
      }).join('<br>') + '</td></tr>';
    }).join('') + '</table>';
    return { html: page('รายงานการสอนแทน', 'ภาคเรียนที่ ' + term.semester + '/' + term.year, body), name: 'รายงานสอนแทน_' + termId };
  }

  function folder() {
    var it = DriveApp.getFoldersByName(FOLDER);
    return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
  }

  /** payload: { kind: class|teacher|overview|daily|subs, term_id, class_id, teacher_id, day, date } */
  function pdf(payload) {
    var r;
    switch (payload.kind) {
      case 'class': r = classHtml(requireTerm_(payload.term_id), payload.class_id); break;
      case 'teacher': r = teacherHtml(requireTerm_(payload.term_id), payload.teacher_id); break;
      case 'overview': r = overviewHtml(requireTerm_(payload.term_id), payload.day); break;
      case 'daily': if (!Rules.isIsoDate(String(payload.date || ''))) throw new AppError('VALIDATION', 'วันที่ไม่ถูกต้อง'); r = dailyHtml(payload.date); break;
      case 'subs': r = subsHtml(requireTerm_(payload.term_id)); break;
      default: throw new AppError('VALIDATION', 'ไม่รู้จักรูปแบบเอกสาร');
    }
    var blob = Utilities.newBlob(r.html, 'text/html', r.name + '.html').getAs('application/pdf').setName(r.name + '.pdf');
    var url = '';
    try {
      var f = folder();
      var file = f.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      url = file.getUrl();
      var files = [], it = f.getFiles();
      while (it.hasNext()) files.push(it.next());
      files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
      files.slice(KEEP).forEach(function (x) { x.setTrashed(true); });
    } catch (e) { url = ''; }
    return { filename: r.name + '.pdf', base64: Utilities.base64Encode(blob.getBytes()), url: url };
  }

  return { pdf: pdf, classHtml: classHtml, teacherHtml: teacherHtml, overviewHtml: overviewHtml, dailyHtml: dailyHtml, subsHtml: subsHtml };
})();
