/* Motor de cálculo: clasificación por departamento, filtros, indicadores y controles de calidad.
 * Sin dependencias del DOM: se ejecuta en el navegador y en Node (scripts/qa-check.mjs). */
(function (root) {
  'use strict';

  var CONFIG = root.CTConfig || (typeof require !== 'undefined' ? require('./config.js') : null);
  var EXCLUDED = '__EXCLUDED__';
  var UNCLASSIFIED = 'Sin clasificar';

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function canonDept(s) {
    var n = norm(s);
    if (!n) return null;
    if (n === norm(CONFIG.excludeLabel)) return EXCLUDED;
    for (var i = 0; i < CONFIG.departments.length; i++) {
      if (norm(CONFIG.departments[i]) === n) return CONFIG.departments[i];
    }
    if (n === 'cobro' || n === 'cobranza') return 'Cobros';
    if (n === 'venta') return 'Ventas';
    return null; // departamento no reconocido
  }

  // ---------- estadística ----------
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : null; }
  // Percentil con interpolación lineal (equivalente a PERCENTIL.INC de Excel)
  function percentile(a, p) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function ratio(n, d) { return d > 0 ? n / d * 100 : null; }

  // Separa duraciones válidas, excluidas (> 2 h) y no válidas (nulas)
  // zeroUnmeasured: en conversaciones, 0 s en una llamada con agente se trata como «no medida»
  // (se cuenta en volúmenes, no entra en promedios ni medianas).
  function durations(recs, field, zeroUnmeasured) {
    var vals = [], excluded = 0, invalid = 0, zeros = 0;
    for (var i = 0; i < recs.length; i++) {
      var v = recs[i][field];
      if (v === null || v === undefined || !isFinite(v) || v < 0) { invalid++; continue; }
      if (v > CONFIG.maxDurationSec) { excluded++; continue; }
      if (v === 0) { zeros++; if (zeroUnmeasured) continue; }
      vals.push(v);
    }
    return { values: vals, n: vals.length, excluded: excluded, invalid: invalid, zeros: zeros };
  }

  function groupBy(recs, fn) {
    var m = new Map();
    for (var i = 0; i < recs.length; i++) {
      var k = fn(recs[i]);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(recs[i]);
    }
    return m;
  }

  // ---------- preparación ----------
  function prepare(dataset) {
    var mappingIssues = [];
    var map = new Map(); // campaña normalizada → {campaign, dept}
    (dataset.mapping || []).forEach(function (pair) {
      var c = pair[0], dRaw = pair[1];
      if (!c) return;
      var key = norm(c);
      var dept = canonDept(dRaw);
      if (dept === null) {
        mappingIssues.push('La campaña «' + c + '» tiene un departamento no reconocido («' + (dRaw || 'vacío') + '»); sus registros quedan «Sin clasificar».');
        dept = UNCLASSIFIED;
      }
      if (map.has(key) && map.get(key).dept !== dept) {
        mappingIssues.push('La campaña «' + c + '» aparece con dos departamentos en la tabla; se conserva el primero («' + map.get(key).dept + '»).');
        return;
      }
      if (!map.has(key)) map.set(key, { campaign: c, dept: dept });
    });

    var records = [], excluded = [], unclassified = [], noDate = [];
    dataset.records.forEach(function (r) {
      var m = map.get(norm(r.c));
      var dept = m ? m.dept : UNCLASSIFIED;
      if (dept === EXCLUDED) { excluded.push(r); return; }
      var o = Object.assign({}, r);
      o.dept = dept;
      if (r.t) {
        o.day = r.t.slice(0, 10);
        o.month = r.t.slice(0, 7);
        o.hour = parseInt(r.t.slice(11, 13), 10);
        var dt = new Date(Date.UTC(+r.t.slice(0, 4), +r.t.slice(5, 7) - 1, +r.t.slice(8, 10)));
        o.wd = (dt.getUTCDay() + 6) % 7; // 0 = lunes
      } else {
        o.day = null; o.month = null; o.hour = null; o.wd = null;
        noDate.push(o);
      }
      if (dept === UNCLASSIFIED) unclassified.push(o);
      records.push(o);
    });

    var partial = detectPartialDays(records);
    var qa = buildQA(dataset, records, excluded, unclassified, noDate, mappingIssues, map, partial);

    var campaignsByDept = {};
    records.forEach(function (r) {
      if (!campaignsByDept[r.dept]) campaignsByDept[r.dept] = {};
      campaignsByDept[r.dept][r.c] = (campaignsByDept[r.dept][r.c] || 0) + 1;
    });

    var months = Array.from(new Set(records.map(function (r) { return r.month; }).filter(Boolean))).sort();
    var days = Array.from(new Set(records.map(function (r) { return r.day; }).filter(Boolean))).sort();

    return { records: records, excluded: excluded, unclassified: unclassified, qa: qa, partial: partial,
      campaignsByDept: campaignsByDept, months: months, days: days, meta: dataset.meta, mapping: map };
  }

  /* Día parcial confirmado: el primer o el último día del archivo se marca como parcial solo si
   * su primer registro es posterior al primer registro más tardío, o su último registro es anterior
   * al último registro más temprano, del resto de días del mismo tipo (lunes–viernes, sábado o domingo). */
  function detectPartialDays(records) {
    var byDay = {};
    records.forEach(function (r) {
      if (!r.day) return;
      var tm = r.t.slice(11, 19);
      var b = byDay[r.day] || (byDay[r.day] = { first: tm, last: tm, wd: r.wd });
      if (tm < b.first) b.first = tm;
      if (tm > b.last) b.last = tm;
    });
    var days = Object.keys(byDay).sort();
    var out = {};
    if (days.length < 2) return out;
    function toMin(t) { return (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)); }
    var margin = CONFIG.partialDayMarginMin || 0;
    function cls(wd) { return wd <= 4 ? 'lv' : (wd === 5 ? 'sab' : 'dom'); }
    function peers(day) {
      return days.filter(function (d) { return d !== day && cls(byDay[d].wd) === cls(byDay[day].wd); });
    }
    var lastDay = days[days.length - 1], firstDay = days[0];
    var pl = peers(lastDay);
    if (pl.length) {
      var minLast = pl.map(function (d) { return byDay[d].last; }).sort()[0];
      if (toMin(minLast) - toMin(byDay[lastDay].last) >= margin) {
        out[lastDay] = { type: 'end', cut: byDay[lastDay].last.slice(0, 5), reference: minLast.slice(0, 5) };
      }
    }
    var pf = peers(firstDay).filter(function (d) { return d !== lastDay || !out[lastDay]; });
    if (pf.length && firstDay !== lastDay) {
      var maxFirst = pf.map(function (d) { return byDay[d].first; }).sort().slice(-1)[0];
      if (toMin(byDay[firstDay].first) - toMin(maxFirst) >= margin) {
        out[firstDay] = { type: 'start', cut: byDay[firstDay].first.slice(0, 5), reference: maxFirst.slice(0, 5) };
      }
    }
    return out;
  }

  function buildQA(dataset, records, excluded, unclassified, noDate, mappingIssues, map, partial) {
    var total = dataset.records.length;
    var byDept = {};
    CONFIG.departments.concat([UNCLASSIFIED]).forEach(function (d) { byDept[d] = { E: 0, S: 0, otro: 0, total: 0 }; });
    records.forEach(function (r) {
      var b = byDept[r.dept] || (byDept[r.dept] = { E: 0, S: 0, otro: 0, total: 0 });
      b.total++;
      if (r.d === 'E') b.E++; else if (r.d === 'S') b.S++; else b.otro++;
    });
    var sumDept = 0; Object.keys(byDept).forEach(function (k) { sumDept += byDept[k].total; });

    var excludedByCampaign = {};
    excluded.forEach(function (r) { excludedByCampaign[r.c] = (excludedByCampaign[r.c] || 0) + 1; });
    var unclassifiedByCampaign = {};
    unclassified.forEach(function (r) { unclassifiedByCampaign[r.c] = (unclassifiedByCampaign[r.c] || 0) + 1; });

    // Duplicados por identificador de conversación
    var seen = {}, dupIds = 0, noId = 0;
    dataset.records.forEach(function (r) {
      if (!r.id) { noId++; return; }
      if (seen[r.id]) dupIds++; else seen[r.id] = 1;
    });

    // Duraciones > 2 h detectadas (todas las columnas de tiempo, registros incluidos)
    var longDur = { we: 0, wa: 0, wc: 0 };
    records.forEach(function (r) {
      ['we', 'wa', 'wc'].forEach(function (f) { if (r[f] != null && r[f] > CONFIG.maxDurationSec) longDur[f]++; });
    });

    // Consistencia de estados
    var outState = { ok: 0, none: 0, multi: 0 };
    var inState = { ofrecidas: 0, ofrecidasSinEstado: 0, ofrecidasMulti: 0 };
    records.forEach(function (r) {
      if (r.d === 'S') {
        var k = (r.a === 1 ? 1 : 0) + (r.ab === 1 ? 1 : 0) + (r.cn === 1 ? 1 : 0);
        if (k === 1) outState.ok++; else if (k === 0) outState.none++; else outState.multi++;
      } else if (r.d === 'E' && r.q === 1) {
        inState.ofrecidas++;
        var k2 = (r.a === 1 ? 1 : 0) + (r.ab === 1 ? 1 : 0);
        if (k2 === 0) inState.ofrecidasSinEstado++; else if (k2 > 1) inState.ofrecidasMulti++;
      }
    });

    var unmappedCampaigns = Object.keys(unclassifiedByCampaign);

    return {
      totalFile: total,
      included: records.length,
      excludedTotal: excluded.length,
      excludedByCampaign: excludedByCampaign,
      unclassifiedTotal: unclassified.length,
      unclassifiedByCampaign: unclassifiedByCampaign,
      unmappedCampaigns: unmappedCampaigns,
      byDept: byDept,
      reconciled: (sumDept + excluded.length) === total,
      sumDept: sumDept,
      duplicateIds: dupIds,
      recordsWithoutId: noId,
      recordsWithoutDate: noDate.length,
      recordsWithoutDirection: records.filter(function (r) { return !r.d; }).length,
      longDurations: longDur,
      outboundStates: outState,
      inboundStates: inState,
      mappingIssues: mappingIssues,
      partial: partial,
      parserStats: (dataset.meta && dataset.meta.stats) || {},
      parserIssues: (dataset.meta && dataset.meta.issues) || [],
      singleDepartmentPerRecord: true // por construcción: cada registro recibe un único departamento desde un mapa campaña → departamento
    };
  }

  // ---------- filtros ----------
  function applyFilters(model, f) {
    return model.records.filter(function (r) {
      if (f.depts && !f.depts.has(r.dept)) return false;
      if (f.campaigns && !f.campaigns.has(r.c)) return false;
      if (f.dateFrom && (!r.day || r.day < f.dateFrom)) return false;
      if (f.dateTo && (!r.day || r.day > f.dateTo)) return false;
      if (f.month && r.month !== f.month) return false;
      if (f.monthFrom && (!r.month || r.month < f.monthFrom)) return false;
      if (f.monthTo && (!r.month || r.month > f.monthTo)) return false;
      return true;
    });
  }

  function axes(recs) {
    var days = Array.from(new Set(recs.map(function (r) { return r.day; }).filter(Boolean))).sort();
    var hours = recs.map(function (r) { return r.hour; }).filter(function (h) { return h !== null && h !== undefined; });
    var hmin = hours.length ? Math.min.apply(null, hours) : 0, hmax = hours.length ? Math.max.apply(null, hours) : 23;
    var hs = []; for (var h = hmin; h <= hmax; h++) hs.push(h);
    return { days: days, hours: hs };
  }

  // ---------- entrantes (SAC, Crédito, línea entrante de Cobros) ----------
  function inbound(recsAll, ax) {
    var total = recsAll.length;
    var ofr = recsAll.filter(function (r) { return r.q === 1; });
    var aten = ofr.filter(function (r) { return r.a === 1; });
    var ab = ofr.filter(function (r) { return r.ab === 1; });
    var abSis = ab.filter(function (r) { return r.f === 'ACD timeout'; });
    var abCli = ab.filter(function (r) { return r.f === 'Contacto'; });
    var abOtro = ab.length - abSis.length - abCli.length;
    var sinEstado = ofr.length - aten.length - ab.length;

    var waitAten = durations(aten, 'we');
    var sl = aten.filter(function (r) { return r.we != null && r.we >= 0 && r.we <= CONFIG.slThresholdSec; }).length;
    var talk = durations(aten, 'wa', true);
    var tr = aten.filter(function (r) { return r.tr === 1; });

    function dayRow(list) {
      var o = list.filter(function (r) { return r.q === 1; });
      var a = o.filter(function (r) { return r.a === 1; }).length;
      var b = o.filter(function (r) { return r.ab === 1; }).length;
      return { ofr: o.length, aten: a, ab: b, pct: ratio(b, o.length) };
    }
    var gDay = groupBy(recsAll, function (r) { return r.day; });
    var byDay = ax.days.map(function (d) { var x = dayRow(gDay.get(d) || []); x.day = d; return x; });
    var gHour = groupBy(recsAll, function (r) { return r.hour; });
    var byHour = ax.hours.map(function (h) { var x = dayRow(gHour.get(h) || []); x.hour = h; return x; });

    var heat = [];
    for (var w = 0; w < 7; w++) {
      heat.push(ax.hours.map(function (h) {
        var l = recsAll.filter(function (r) { return r.wd === w && r.hour === h; });
        return dayRow(l);
      }));
    }

    var bAten = CONFIG.waitBuckets.map(function () { return 0; });
    var bAb = CONFIG.waitBuckets.map(function () { return 0; });
    var bInvalid = { aten: 0, ab: 0 };
    function bucketOf(s) { for (var i = 0; i < CONFIG.waitBuckets.length; i++) if (s <= CONFIG.waitBuckets[i].max) return i; return -1; }
    aten.forEach(function (r) { if (r.we == null || r.we < 0 || r.we > CONFIG.maxDurationSec) bInvalid.aten++; else bAten[bucketOf(r.we)]++; });
    ab.forEach(function (r) { if (r.we == null || r.we < 0 || r.we > CONFIG.maxDurationSec) bInvalid.ab++; else bAb[bucketOf(r.we)]++; });

    var gAg = groupBy(aten.filter(function (r) { return r.agL; }), function (r) { return r.agL; });
    var agents = [];
    gAg.forEach(function (list, name) {
      var t = durations(list, 'wa', true);
      agents.push({ name: name, aten: list.length, talkMean: t.n ? mean(t.values) / 60 : null, talkN: t.n });
    });
    agents.sort(function (x, y) { return y.aten - x.aten || (x.name < y.name ? -1 : 1); });

    return {
      total: total, ofrecidas: ofr.length, sinCola: total - ofr.length,
      atendidas: aten.length, abandonadas: ab.length, abSistema: abSis.length, abCliente: abCli.length, abOtro: abOtro,
      sinEstado: sinEstado,
      pctAb: ratio(ab.length, ofr.length), pctAbSis: ratio(abSis.length, ofr.length), pctAbCli: ratio(abCli.length, ofr.length),
      sl20: sl, ns: ratio(sl, ofr.length), atenSinEspera: waitAten.invalid,
      wait: { n: waitAten.n, mean: mean(waitAten.values), p90: percentile(waitAten.values, 0.9), excluded: waitAten.excluded, invalid: waitAten.invalid },
      talk: { n: talk.n, mean: talk.n ? mean(talk.values) / 60 : null, median: talk.n ? percentile(talk.values, 0.5) / 60 : null,
        excluded: talk.excluded, invalid: talk.invalid, zeros: talk.zeros },
      transfers: { n: tr.length, ok: tr.filter(function (r) { return r.tro === 1; }).length, pct: ratio(tr.length, aten.length) },
      byDay: byDay, byHour: byHour, heat: heat, buckets: { aten: bAten, ab: bAb, invalid: bInvalid }, agents: agents
    };
  }

  // ---------- salientes ----------
  function outStatus(r) {
    if (r.a === 1) return 'con';
    if (r.ab === 1) return r.m === 'Marcación' ? 'abMarc' : 'abOtro';
    if (r.cn === 1) return 'noCon';
    return 'sinEstado';
  }

  function outboundBlock(list) {
    var o = { intentos: list.length, con: 0, abMarc: 0, abOtro: 0, noCon: 0, sinEstado: 0 };
    list.forEach(function (r) { o[outStatus(r)]++; });
    o.contestadas = o.con + o.abMarc + o.abOtro;
    o.pctCon = ratio(o.con, o.intentos);
    return o;
  }

  function outbound(recs, ax) {
    var base = outboundBlock(recs);
    var modes = {};
    ['Manual', 'Marcación'].forEach(function (m) {
      modes[m] = outboundBlock(recs.filter(function (r) { return r.m === m; }));
    });
    modes.otro = outboundBlock(recs.filter(function (r) { return r.m !== 'Manual' && r.m !== 'Marcación'; }));
    var mar = modes['Marcación'];
    var pctAbMarc = ratio(mar.abMarc, mar.con + mar.abMarc);

    var phones = new Set(), sinNumero = 0;
    recs.forEach(function (r) { if (r.p) phones.add(r.p); else sinNumero++; });
    var tip = recs.filter(function (r) { return !!r.ty; }).length;
    var conList = recs.filter(function (r) { return r.a === 1; });
    var talk = durations(conList, 'wc', true);

    function series(keyFn, keys) {
      var g = groupBy(recs, keyFn);
      return keys.map(function (k) {
        var l = g.get(k) || [];
        var b = outboundBlock(l);
        b.key = k;
        b.byMode = {
          Manual: outboundBlock(l.filter(function (r) { return r.m === 'Manual'; })),
          'Marcación': outboundBlock(l.filter(function (r) { return r.m === 'Marcación'; }))
        };
        return b;
      });
    }
    var byDay = series(function (r) { return r.day; }, ax.days);
    var byHour = series(function (r) { return r.hour; }, ax.hours);
    var campKeys = Array.from(new Set(recs.map(function (r) { return r.c; })));
    var byCampaign = series(function (r) { return r.c; }, campKeys).sort(function (a, b) { return b.intentos - a.intentos; });
    var agKeys = Array.from(new Set(recs.map(function (r) { return r.ag1; }).filter(Boolean)));
    var gAg = groupBy(recs, function (r) { return r.ag1; });
    var byAgent = series(function (r) { return r.ag1; }, agKeys).map(function (b) {
      var t = durations((gAg.get(b.key) || []).filter(function (r) { return r.a === 1; }), 'wc', true);
      b.talkMean = t.n ? mean(t.values) / 60 : null; b.talkN = t.n;
      return b;
    }).sort(function (a, b) { return b.intentos - a.intentos || (a.key < b.key ? -1 : 1); });
    var sinAgente = recs.filter(function (r) { return !r.ag1; }).length;

    return {
      base: base, modes: modes, pctAbMarc: pctAbMarc,
      unicos: phones.size, sinNumero: sinNumero, intentosPorNumero: phones.size ? recs.length / phones.size : null,
      tipificada: tip, pctTip: ratio(tip, recs.length),
      talk: { n: talk.n, mean: talk.n ? mean(talk.values) / 60 : null, median: talk.n ? percentile(talk.values, 0.5) / 60 : null,
        excluded: talk.excluded, invalid: talk.invalid, zeros: talk.zeros },
      byDay: byDay, byHour: byHour, byCampaign: byCampaign, byAgent: byAgent, sinAgente: sinAgente
    };
  }

  function salesGroup(ty) {
    if (!ty) return 'Sin tipificación';
    var rules = CONFIG.salesGroups;
    if (Object.prototype.hasOwnProperty.call(rules.exactRules, ty)) return rules.exactRules[ty];
    for (var i = 0; i < rules.prefixRules.length; i++) if (ty.indexOf(rules.prefixRules[i].prefix) === 0) return rules.prefixRules[i].group;
    return 'Otras tipificaciones (sin agrupar)';
  }

  // ---------- pestañas ----------
  function computeGeneral(recs) {
    var ax = axes(recs);
    var depts = CONFIG.departments.slice();
    if (recs.some(function (r) { return r.dept === UNCLASSIFIED; })) depts.push(UNCLASSIFIED);
    var E = recs.filter(function (r) { return r.d === 'E'; });
    var S = recs.filter(function (r) { return r.d === 'S'; });
    var inb = inbound(E, ax);
    var out = outboundBlock(S);
    var perDept = depts.map(function (d) {
      var e = E.filter(function (r) { return r.dept === d; });
      var s = S.filter(function (r) { return r.dept === d; });
      var ib = inbound(e, { days: [], hours: [] });
      var ob = outboundBlock(s);
      return { dept: d, E: e.length, S: s.length, total: recs.filter(function (r) { return r.dept === d; }).length,
        ofrecidas: ib.ofrecidas, pctAb: ib.pctAb, intentos: ob.intentos, pctCon: ob.pctCon };
    });
    var gDay = groupBy(recs, function (r) { return r.day; });
    var dayDept = ax.days.map(function (d) {
      var l = gDay.get(d) || [];
      var o = { day: d };
      depts.forEach(function (dp) { o[dp] = l.filter(function (r) { return r.dept === dp; }).length; });
      return o;
    });
    var gH = groupBy(recs, function (r) { return r.hour; });
    var hour = ax.hours.map(function (h) {
      var l = gH.get(h) || [];
      return { hour: h, ofrecidas: l.filter(function (r) { return r.d === 'E' && r.q === 1; }).length,
        intentos: l.filter(function (r) { return r.d === 'S'; }).length };
    });
    var outDay = outbound(S, ax).byDay;
    var outModes = { Manual: 0, 'Marcación': 0, otro: 0 };
    S.forEach(function (r) { if (r.m === 'Manual' || r.m === 'Marcación') outModes[r.m]++; else outModes.otro++; });
    return { ax: ax, depts: depts, total: recs.length, entrantes: E.length, salientes: S.length, inb: inb, out: out,
      perDept: perDept, dayDept: dayDept, hour: hour, outDay: outDay, outModes: outModes };
  }

  function computeInboundView(recs, dept, allFiltered) {
    var ax = axes(allFiltered);
    var E = recs.filter(function (r) { return r.dept === dept && r.d === 'E'; });
    var res = inbound(E, ax);
    res.ax = ax;
    if (dept === 'Crédito') {
      var S = recs.filter(function (r) { return r.dept === dept && r.d === 'S'; });
      res.outbound = S.length ? outboundBlock(S) : null;
      var sac = inbound(recs.filter(function (r) { return r.dept === 'SAC' && r.d === 'E'; }), ax);
      res.sacRefByHour = sac.byHour.map(function (x) { return x.pct; });
      res.sacRefAvailable = sac.ofrecidas > 0;
    }
    return res;
  }

  function computeVentas(recs, allFiltered) {
    var ax = axes(allFiltered);
    var S = recs.filter(function (r) { return r.dept === 'Ventas' && r.d === 'S'; });
    var res = outbound(S, ax);
    res.ax = ax;
    var con = S.filter(function (r) { return r.a === 1; });
    var conTip = con.filter(function (r) { return !!r.ty; });
    var conSeg = conTip.filter(function (r) { return salesGroup(r.ty) === 'Seguimiento'; });
    res.funnel = [
      { name: 'Intentos', value: S.length },
      { name: 'Contestadas', value: res.base.contestadas },
      { name: 'Con agente', value: res.base.con },
      { name: 'Con agente y gestión tipificada', value: conTip.length },
      { name: 'Seguimiento', value: conSeg.length }
    ];
    var groups = {};
    CONFIG.salesGroups.order.forEach(function (g) { groups[g] = 0; });
    var detail = {};
    con.forEach(function (r) {
      var g = salesGroup(r.ty); groups[g] = (groups[g] || 0) + 1;
      if (r.ty) detail[r.ty] = { group: g, n: (detail[r.ty] ? detail[r.ty].n : 0) + 1 };
    });
    res.groups = groups;
    res.groupDetail = detail;
    res.tipNoCon = S.filter(function (r) { return r.ty && r.a !== 1; }).length;
    var segAll = S.filter(function (r) { return r.ty && salesGroup(r.ty) === 'Seguimiento'; }).length;
    res.segNoCon = segAll - conSeg.length;
    return res;
  }

  function computeCobros(recs, allFiltered) {
    var ax = axes(allFiltered);
    var S = recs.filter(function (r) { return r.dept === 'Cobros' && r.d === 'S'; });
    var E = recs.filter(function (r) { return r.dept === 'Cobros' && r.d === 'E'; });
    var res = outbound(S, ax);
    res.ax = ax;
    res.inb = inbound(E, ax);
    res.topAgents = res.byAgent.slice(0, CONFIG.topAgents);
    return res;
  }

  var api = {
    prepare: prepare, applyFilters: applyFilters, computeGeneral: computeGeneral,
    computeInboundView: computeInboundView, computeVentas: computeVentas, computeCobros: computeCobros,
    salesGroup: salesGroup, percentile: percentile, UNCLASSIFIED: UNCLASSIFIED
  };
  root.CTMetrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
