/* Lectura del Excel de inConcert y normalización de registros.
 * Se ejecuta igual en el navegador (carga local) y en Node (scripts/build-dataset.mjs),
 * de modo que existe una sola implementación de las reglas de extracción. */
(function (root) {
  'use strict';

  var CONFIG = root.CTConfig || (typeof require !== 'undefined' ? require('./config.js') : null);

  // Esquema compacto del dataset (orden de columnas en dataset.json)
  var FIELDS = ['id', 'c', 't', 'd', 'q', 'a', 'ab', 'cn', 'f', 'm', 'ag1', 'agL', 'p', 'we', 'wa', 'wc', 'ty', 'tr', 'tro'];

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function isNullish(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') {
      var s = v.trim();
      return s === '' || s.toUpperCase() === 'N/A' || s === '-';
    }
    return false;
  }

  function toBool(v) {
    if (isNullish(v)) return null;
    var s = norm(v);
    if (s === 'si' || s === 'yes' || s === 'true' || s === '1') return 1;
    if (s === 'no' || s === 'false' || s === '0') return 0;
    return null;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Serial de Excel (sistema 1900) → texto de fecha-hora local «YYYY-MM-DDTHH:MM:SS» sin zona
  function serialToIso(serial) {
    var ms = Math.round((serial - 25569) * 86400) * 1000;
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }

  function parseDateTime(v) {
    if (isNullish(v)) return null;
    if (typeof v === 'number' && isFinite(v) && v > 0) return serialToIso(v);
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()) + 'T' +
        pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds());
    }
    var s = String(v).trim(), m;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) + 'T' + pad(+m[4]) + ':' + m[5] + ':' + (m[6] || '00');
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]) + 'T' + pad(+m[4]) + ':' + m[5] + ':' + (m[6] || '00');
    return null;
  }

  // Duración → segundos. Acepta fracción de día (Excel) o texto «H:MM:SS».
  function parseDuration(v) {
    if (isNullish(v)) return null;
    if (typeof v === 'number' && isFinite(v)) {
      if (v < 0) return null;
      return Math.round(v * 86400);
    }
    var s = String(v).trim();
    var m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    return null;
  }

  // Teléfono: solo dígitos. Si tiene 11 dígitos y prefijo 506 (Costa Rica), se usan los 8 finales.
  function normalizePhone(v, stats) {
    if (isNullish(v)) return null;
    var digits = String(typeof v === 'number' ? Math.round(v) : v).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 11 && digits.indexOf('506') === 0) {
      if (stats) stats.phonePrefixStripped++;
      return digits.slice(3);
    }
    return digits;
  }

  function finalizerCategory(v) {
    if (isNullish(v)) return null;
    var s = String(v).trim();
    if (/^agente\s*:/i.test(s)) return 'Agente';
    return s;
  }

  function strOrNull(v) { return isNullish(v) ? null : String(v).trim(); }

  function findHeaderRow(rows, required) {
    var limit = Math.min(rows.length, 15);
    for (var r = 0; r < limit; r++) {
      var row = rows[r] || [];
      var names = row.map(norm);
      var ok = required.every(function (h) { return names.indexOf(norm(h)) >= 0; });
      if (ok) return r;
    }
    return -1;
  }

  function readMapping(rows) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      for (var i = 0; i < row.length - 1; i++) {
        if (norm(row[i]) === 'campana' && norm(row[i + 1]) === 'departamento') {
          var out = [];
          for (var k = r + 1; k < rows.length; k++) {
            var rr = rows[k] || [];
            var c = rr[i], d = rr[i + 1];
            if (isNullish(c) && isNullish(d)) break;
            out.push([strOrNull(c), strOrNull(d)]);
          }
          return out;
        }
      }
    }
    return null;
  }

  /**
   * @param XLSX  instancia de SheetJS
   * @param data  ArrayBuffer | Uint8Array | Buffer
   * @param fileName nombre del archivo (metadato)
   */
  function parseWorkbook(XLSX, data, fileName) {
    var wb = XLSX.read(data, { type: 'array', cellDates: false, raw: false });
    var C = CONFIG.columns;
    var required = [C.campaign, C.start, C.direction];
    var detail = null, mapping = null, mappingSheet = null, issues = [];

    wb.SheetNames.forEach(function (name) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
      var h = findHeaderRow(rows, required);
      if (h >= 0 && !detail) { detail = { name: name, rows: rows, headerRow: h }; return; }
      if (!mapping) {
        var mp = readMapping(rows);
        if (mp && mp.length) { mapping = mp; mappingSheet = name; }
      }
    });

    if (!detail) throw new Error('No se encontró la hoja de detalle: ninguna hoja contiene las columnas «' + required.join('», «') + '».');
    if (!mapping) throw new Error('No se encontró la tabla «Campaña → Departamento» en el libro. Debe existir un encabezado «Campaña» seguido de «Departamento».');

    var header = detail.rows[detail.headerRow].map(function (x) { return x == null ? '' : String(x).trim(); });
    var idx = {};
    var missing = [];
    Object.keys(C).forEach(function (k) {
      var pos = -1;
      for (var i = 0; i < header.length; i++) { if (norm(header[i]) === norm(C[k])) { pos = i; break; } }
      idx[k] = pos;
      if (pos < 0) missing.push(C[k]);
    });
    var hardRequired = [C.campaign, C.start, C.direction, C.answered, C.abandoned];
    var hardMissing = missing.filter(function (m) { return hardRequired.indexOf(m) >= 0; });
    if (hardMissing.length) throw new Error('Faltan columnas obligatorias: ' + hardMissing.join(', '));
    if (missing.length) issues.push('Columnas no encontradas (las métricas que dependen de ellas se omiten): ' + missing.join(', '));

    var stats = { phonePrefixStripped: 0, invalidDates: 0, invalidDurations: 0, rowsRead: 0, blankRows: 0 };
    var records = [];
    function get(row, key) { return idx[key] >= 0 ? row[idx[key]] : null; }

    for (var r = detail.headerRow + 1; r < detail.rows.length; r++) {
      var row = detail.rows[r];
      if (!row || row.every(isNullish)) { stats.blankRows++; continue; }
      stats.rowsRead++;
      var t = parseDateTime(get(row, 'start'));
      if (!t) stats.invalidDates++;
      var dirRaw = norm(get(row, 'direction'));
      var dir = dirRaw.indexOf('ent') === 0 ? 'E' : (dirRaw.indexOf('sal') === 0 ? 'S' : null);
      var modeRaw = strOrNull(get(row, 'dialMode'));
      var mode = null;
      if (modeRaw) {
        var mn = norm(modeRaw);
        mode = mn.indexOf('manual') === 0 ? 'Manual' : (mn.indexOf('marcac') === 0 ? 'Marcación' : modeRaw);
      }
      var we = parseDuration(get(row, 'wait'));
      var wa = parseDuration(get(row, 'talkIn'));
      var wc = parseDuration(get(row, 'talkOut'));
      ['wait', 'talkIn', 'talkOut'].forEach(function (k) {
        var raw = get(row, k);
        if (!isNullish(raw) && parseDuration(raw) === null) stats.invalidDurations++;
      });
      var ty = strOrNull(get(row, 'dispAbs')) || strOrNull(get(row, 'disp'));
      records.push({
        id: strOrNull(get(row, 'convId')),
        c: strOrNull(get(row, 'campaign')),
        t: t,
        d: dir,
        q: toBool(get(row, 'queued')),
        a: toBool(get(row, 'answered')),
        ab: toBool(get(row, 'abandoned')),
        cn: toBool(get(row, 'cancelled')),
        f: finalizerCategory(get(row, 'finalizer')),
        m: mode,
        ag1: strOrNull(get(row, 'firstAgent')),
        agL: strOrNull(get(row, 'lastAgent')),
        p: normalizePhone(get(row, 'phone'), stats),
        we: we, wa: wa, wc: wc,
        ty: ty,
        tr: toBool(get(row, 'transfer')),
        tro: toBool(get(row, 'transferOk'))
      });
    }

    return {
      meta: {
        fileName: fileName || null,
        detailSheet: detail.name,
        mappingSheet: mappingSheet,
        loadedAt: new Date().toISOString(),
        stats: stats,
        issues: issues,
        anonymized: false
      },
      mapping: mapping,
      records: records
    };
  }

  // Serializa a dataset compacto. hashFn(phone) → Promise<string> para anonimizar números.
  function toCompact(dataset, hashFn) {
    var phones = {};
    dataset.records.forEach(function (r) { if (r.p) phones[r.p] = true; });
    var keys = Object.keys(phones);
    return Promise.all(keys.map(function (k) { return hashFn(k); })).then(function (hashes) {
      var lut = {};
      keys.forEach(function (k, i) { lut[k] = hashes[i]; });
      return {
        format: 'ct-dashboard-dataset',
        version: 1,
        generatedAt: new Date().toISOString(),
        source: {
          fileName: dataset.meta.fileName,
          detailSheet: dataset.meta.detailSheet,
          mappingSheet: dataset.meta.mappingSheet,
          stats: dataset.meta.stats,
          issues: dataset.meta.issues
        },
        anonymized: true,
        anonymization: 'Teléfonos reemplazados por SHA-256 con sal aleatoria descartada; nombres de contacto no se exportan.',
        mapping: dataset.mapping,
        fields: FIELDS,
        rows: dataset.records.map(function (r) {
          return FIELDS.map(function (f) { return f === 'p' ? (r.p ? lut[r.p] : null) : (r[f] === undefined ? null : r[f]); });
        })
      };
    });
  }

  function fromCompact(json) {
    if (!json || json.format !== 'ct-dashboard-dataset') throw new Error('El archivo no es un dataset válido del dashboard.');
    var f = json.fields;
    var records = json.rows.map(function (row) {
      var o = {};
      for (var i = 0; i < f.length; i++) o[f[i]] = row[i];
      return o;
    });
    return {
      meta: {
        fileName: json.source && json.source.fileName,
        detailSheet: json.source && json.source.detailSheet,
        mappingSheet: json.source && json.source.mappingSheet,
        loadedAt: json.generatedAt,
        stats: (json.source && json.source.stats) || {},
        issues: (json.source && json.source.issues) || [],
        anonymized: !!json.anonymized
      },
      mapping: json.mapping,
      records: records
    };
  }

  var api = { parseWorkbook: parseWorkbook, toCompact: toCompact, fromCompact: fromCompact, FIELDS: FIELDS,
    _internals: { parseDuration: parseDuration, parseDateTime: parseDateTime, normalizePhone: normalizePhone, norm: norm } };
  root.CTParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
