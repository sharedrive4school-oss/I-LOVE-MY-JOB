/**
 * Auth.gs — การเข้าสู่ระบบของ Admin (ข้อ 39)
 *
 * - รหัสผ่านเก็บเป็น SHA-256 + salt ใน Script Properties (ครูทั่วไปและ Google Sheets มองไม่เห็น)
 * - Login สำเร็จได้ token สุ่ม อายุไม่เกิน 6 ชั่วโมง เก็บใน CacheService
 * - ผิด 5 ครั้ง ล็อกชื่อผู้ใช้นั้น 15 นาที
 * - ทุกฟังก์ชันที่แก้ข้อมูลต้องเรียก Auth.requireAdmin(token) ฝั่งเซิร์ฟเวอร์
 */

var Auth = (function () {
  var PROP_USERS = 'ADMIN_USERS';
  var MAX_FAILS = 5;
  var LOCK_SECONDS = 15 * 60;

  function props() { return PropertiesService.getScriptProperties(); }
  function cache() { return CacheService.getScriptCache(); }

  function hash(salt, password) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
    return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
  }

  function randomToken() {
    return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  }

  function users() {
    var raw = props().getProperty(PROP_USERS);
    return raw ? JSON.parse(raw) : {};
  }

  function normalizeName(username) {
    var u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new AppError('VALIDATION', 'ชื่อผู้ใช้ต้องเป็นอักษรอังกฤษ/ตัวเลข 3–30 ตัว');
    return u;
  }

  /** ตั้ง/เปลี่ยนรหัสผ่าน — เรียกจากเมนูใน Google Sheets โดยเจ้าของไฟล์เท่านั้น */
  function setPassword(username, password, displayName) {
    var u = normalizeName(username);
    if (String(password || '').length < 8) throw new AppError('VALIDATION', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    var all = users();
    var salt = randomToken().slice(0, 24);
    var existed = !!all[u];
    all[u] = { salt: salt, hash: hash(salt, password), name: displayName || (all[u] && all[u].name) || u, updated: new Date().toISOString() };
    props().setProperty(PROP_USERS, JSON.stringify(all));
    return existed ? 'เปลี่ยนรหัสผ่านของ ' + u + ' แล้ว' : 'เพิ่มผู้ดูแลระบบ ' + u + ' แล้ว';
  }

  function removeUser(username) {
    var u = normalizeName(username);
    var all = users();
    if (!all[u]) throw new AppError('NOT_FOUND', 'ไม่พบผู้ใช้ ' + u);
    delete all[u];
    props().setProperty(PROP_USERS, JSON.stringify(all));
  }

  function listUsers() {
    var all = users();
    return Object.keys(all).map(function (u) { return { username: u, name: all[u].name, updated: all[u].updated }; });
  }

  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function login(username, password) {
    var u;
    try { u = normalizeName(username); } catch (e) { throw new AppError('AUTH', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); }
    var failKey = 'fail:' + u;
    var fails = Number(cache().get(failKey) || 0);
    if (fails >= MAX_FAILS) throw new AppError('AUTH_LOCKED', 'ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
    var rec = users()[u];
    var ok = rec && safeEqual(hash(rec.salt, String(password || '')), rec.hash);
    if (!ok) {
      cache().put(failKey, String(fails + 1), LOCK_SECONDS);
      throw new AppError('AUTH', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    cache().remove(failKey);
    var hours = Math.min(6, Math.max(1, Number(settingOr_('session_hours', 6)) || 6));
    var token = randomToken();
    cache().put('tok:' + token, JSON.stringify({ username: u, name: rec.name }), hours * 3600);
    return { token: token, username: u, name: rec.name, expires_in_hours: hours };
  }

  /** คืน ctx ของผู้ใช้ หรือโยน AUTH ถ้า token ไม่ถูกต้อง/หมดอายุ */
  function requireAdmin(token) {
    if (!token || typeof token !== 'string') throw new AppError('AUTH', 'กรุณาเข้าสู่ระบบ Admin');
    var raw = cache().get('tok:' + token);
    if (!raw) throw new AppError('AUTH', 'หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่');
    var s = JSON.parse(raw);
    return { user: s.name + ' (' + s.username + ')', username: s.username };
  }

  function logout(token) { if (token) cache().remove('tok:' + token); return true; }

  function settingOr_(key, fallback) {
    try { var s = Db.get('Settings', key); return s && s.value !== '' ? s.value : fallback; } catch (e) { return fallback; }
  }

  return { hash: hash, setPassword: setPassword, removeUser: removeUser, listUsers: listUsers, login: login, requireAdmin: requireAdmin, logout: logout };
})();
