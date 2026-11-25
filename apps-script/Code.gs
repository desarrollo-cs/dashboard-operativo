/**
 * Almacenamiento en Google Sheets del dashboard operativo (Apps Script, implementado como aplicación web).
 * Hoja «registros»: un registro por fila (columnas = campos del dataset compacto). Hoja «meta»: mapeo y origen.
 * GET  → dataset compacto completo (anonimizado).
 * POST → {clave, dataset}: agrega o actualiza registros por «id». Los teléfonos llegan normalizados y se
 *        convierten aquí en HMAC-SHA256 con una sal secreta; el número real nunca se guarda.
 * Configuración: ejecutar una vez «configurar» desde el editor; muestra la clave de escritura en el registro.
 */
var HOJA_REGISTROS = 'registros';
var HOJA_META = 'meta';
var CAMPOS_NUMERICOS = ['q', 'a', 'ab', 'cn', 'we', 'wa', 'wc', 'tr', 'tro'];

function configurar() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SAL')) props.setProperty('SAL', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('CLAVE_ESCRITURA')) props.setProperty('CLAVE_ESCRITURA', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  hoja_(HOJA_REGISTROS); hoja_(HOJA_META);
  Logger.log('Clave de escritura (escríbala en el dashboard al guardar): ' + props.getProperty('CLAVE_ESCRITURA'));
}

function doGet() {
  var ss = SpreadsheetApp.getActive();
  var meta = leerMeta_(ss);
  var sh = ss.getSheetByName(HOJA_REGISTROS);
  var values = sh && sh.getLastRow() > 1 ? sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues() : [];
  var fields = values.length ? values[0].map(String) : (meta.fields || []);
  // La hoja guarda todo como texto; los campos numéricos del dataset se devuelven como número.
  var num = fields.map(function (f) { return CAMPOS_NUMERICOS.indexOf(f) >= 0; });
  var rows = values.slice(1).map(function (r) { return r.map(function (v, i) { return v === '' ? null : (num[i] ? Number(v) : String(v)); }); });
  return json_({
    format: 'ct-dashboard-dataset', version: 1, generatedAt: meta.updatedAt || null,
    source: meta.source || {}, anonymized: true,
    anonymization: 'Teléfonos reemplazados por HMAC-SHA256 con sal secreta; nombres de contacto no se guardan.',
    mapping: meta.mapping || [], fields: fields, rows: rows
  });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Solicitud no válida.' }); }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLAVE_ESCRITURA') || body.clave !== props.getProperty('CLAVE_ESCRITURA')) return json_({ ok: false, error: 'Clave de escritura incorrecta.' });
  var ds = body.dataset;
  if (!ds || ds.format !== 'ct-dashboard-dataset' || !Array.isArray(ds.fields) || !Array.isArray(ds.rows)) return json_({ ok: false, error: 'El dataset no tiene el formato esperado.' });
  var iId = ds.fields.indexOf('id'), iP = ds.fields.indexOf('p');
  if (iId < 0) return json_({ ok: false, error: 'El dataset no tiene el campo «id».' });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = hoja_(HOJA_REGISTROS);
    var sal = props.getProperty('SAL');
    var existing = sh.getLastRow() > 1 ? sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues() : [];
    if (existing.length && existing[0].join('|') !== ds.fields.join('|')) return json_({ ok: false, error: 'Los campos del dataset no coinciden con los de la hoja.' });
    var rows = existing.slice(1), pos = {};
    rows.forEach(function (r, i) { pos[String(r[iId])] = i; });
    var added = 0, updated = 0;
    ds.rows.forEach(function (r) {
      var row = r.map(function (v) { return v === null || v === undefined ? '' : v; });
      if (iP >= 0 && row[iP] !== '') row[iP] = hmac_(String(row[iP]), sal);
      var k = String(row[iId]);
      if (k in pos) { rows[pos[k]] = row; updated++; } else { pos[k] = rows.length; rows.push(row); added++; }
    });
    sh.clearContents();
    sh.getRange(1, 1, 1, ds.fields.length).setValues([ds.fields]);
    if (rows.length) {
      var range = sh.getRange(2, 1, rows.length, ds.fields.length);
      range.setNumberFormat('@'); // texto plano: evita que Sheets convierta fechas o ids a otro tipo
      range.setValues(rows);
    }
    var meta = leerMeta_(ss);
    meta.mapping = mergeMapping_(meta.mapping || [], ds.mapping || []);
    meta.source = ds.source || {};
    meta.updatedAt = new Date().toISOString();
    escribirMeta_(ss, meta);
    return json_({ ok: true, added: added, updated: updated, total: rows.length, updatedAt: meta.updatedAt });
  } finally {
    lock.releaseLock();
  }
}

function hmac_(text, sal) {
  var sig = Utilities.computeHmacSha256Signature(text, sal);
  return sig.slice(0, 8).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function mergeMapping_(a, b) {
  var m = {};
  a.concat(b).forEach(function (p) { m[p[0]] = p[1]; });
  return Object.keys(m).map(function (k) { return [k, m[k]]; });
}

function hoja_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function leerMeta_(ss) {
  var sh = ss.getSheetByName(HOJA_META);
  var meta = {};
  if (sh && sh.getLastRow() > 0) sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) {
    try { meta[r[0]] = JSON.parse(r[1]); } catch (err) { meta[r[0]] = r[1]; }
  });
  return meta;
}

function escribirMeta_(ss, meta) {
  var sh = hoja_(HOJA_META);
  sh.clearContents();
  var rows = Object.keys(meta).map(function (k) { return [k, JSON.stringify(meta[k])]; });
  sh.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
