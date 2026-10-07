/**
 * Backup.gs — สำรองข้อมูล Google Sheets (ข้อ 46)
 *
 * - backupNow(): คัดลอกไฟล์ทั้งไฟล์ไปโฟลเดอร์สำรองใน Google Drive ของเจ้าของ
 * - เก็บไว้ตามจำนวนในค่า backup_keep (เริ่มต้น 30 ไฟล์) ไฟล์เก่ากว่านั้นย้ายไปถังขยะ (กู้คืนได้ 30 วัน)
 * - installDailyBackup(): ตั้งให้สำรองอัตโนมัติทุกวันเวลาประมาณ 18:00 น.
 */

var Backup = (function () {
  function setting(key, fallback) {
    var s = Db.get('Settings', key);
    return s && s.value !== '' ? s.value : fallback;
  }

  function folder() {
    var name = setting('backup_folder_name', 'สำรองข้อมูล ระบบตารางสอน');
    var it = DriveApp.getFoldersByName(name);
    return it.hasNext() ? it.next() : DriveApp.createFolder(name);
  }

  function backupNow(ctx) {
    var ss = Db.spreadsheet();
    var f = folder();
    var stamp = Utilities.formatDate(new Date(), APP_TZ, 'yyyy-MM-dd_HHmm');
    var copy = DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' — สำรอง ' + stamp, f);
    var keep = Math.max(5, Number(setting('backup_keep', 30)) || 30);
    var files = [], it = f.getFiles();
    while (it.hasNext()) files.push(it.next());
    files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    var trashed = 0;
    files.slice(keep).forEach(function (x) { x.setTrashed(true); trashed++; });
    Db.log(ctx || { user: 'ระบบ (สำรองอัตโนมัติ)' }, 'สำรองข้อมูล', 'Settings', copy.getName(), null, { file_id: copy.getId(), folder: f.getName(), removed_old: trashed });
    return { file_name: copy.getName(), url: copy.getUrl(), folder: f.getName(), removed_old: trashed };
  }

  function installDailyBackup() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'scheduledBackup') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('scheduledBackup').timeBased().everyDays(1).atHour(18).inTimezone(APP_TZ).create();
    return 'ตั้งการสำรองข้อมูลอัตโนมัติทุกวันเวลาประมาณ 18:00 น. แล้ว';
  }

  return { backupNow: backupNow, installDailyBackup: installDailyBackup };
})();

/** ถูกเรียกโดย Trigger รายวัน */
function scheduledBackup() { Backup.backupNow(null); }

function menuBackupNow() {
  var r = Backup.backupNow({ user: 'เจ้าของไฟล์' });
  SpreadsheetApp.getUi().alert('สำรองข้อมูลแล้ว: ' + r.file_name + '\nโฟลเดอร์: ' + r.folder);
}

function menuInstallDailyBackup() {
  SpreadsheetApp.getUi().alert(Backup.installDailyBackup());
}
