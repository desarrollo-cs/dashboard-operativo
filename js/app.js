/* Interfaz del dashboard: carga de datos, filtros combinables, pestañas, KPI, gráficos y metodología. */
(function () {
  'use strict';
  var CONFIG = window.CTConfig, P = window.CTParser, M = window.CTMetrics, CH = window.CTCharts, FN = window.CTFindings, F = CH.F;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    dataset: null, model: null, recs: [], activeTab: 'general', creditView: 'SAC',
    filters: { depts: null, campaigns: null, dateFrom: '', dateTo: '', month: '', monthFrom: '', monthTo: '' },
    charts: {}, dirty: { general: true, sac: true, ventas: true, cobros: true, metodologias: true }, sourceKind: ''
  };
  var TABS = ['general', 'sac', 'ventas', 'cobros', 'metodologias'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
  function monthName(m) {
    var names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return names[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
  }

  // ---------------- carga de datos ----------------
  function setStatus(msg, isError) {
    var el = $('loadStatus');
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function loadDefault() {
    if (location.protocol === 'file:') {
      setStatus('Abierto como archivo local: el navegador bloquea la lectura de data/dataset.json. Carga el Excel con el botón «Cargar Excel» o ejecuta un servidor local (ver README).', true);
      showEmptyPanels('Carga el Excel desde la pestaña «Metodologías» para ver el dashboard.');
      return;
    }
    fetch(CONFIG.defaultDatasetPath, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) { setDataset(P.fromCompact(json), 'integrado'); })
      .catch(function (e) {
        setStatus('No se encontró el dataset integrado (' + e.message + '). Carga el Excel con el botón «Cargar Excel».', true);
        showEmptyPanels('Carga el Excel desde la pestaña «Metodologías» para ver el dashboard.');
      });
  }

  function showEmptyPanels(msg) {
    TABS.forEach(function (t) { var el = t === 'metodologias' ? $('metodoBody') : $('panel-' + t); el.innerHTML = '<p class="loading">' + esc(msg) + '</p>'; });
    $('periodLabel').textContent = '| Período: sin datos cargados';
    $('sourceLabel').textContent = 'Sin datos cargados.';
  }

  function onFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var keep = state.dataset ? ' Se conservan los datos cargados previamente.' : '';
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) { setStatus('Formato no admitido: «' + file.name + '». Usa el .xlsx exportado de inConcert.' + keep, true); ev.target.value = ''; return; }
    setStatus('Procesando «' + file.name + '» en este navegador…');
    var reader = new FileReader();
    reader.onerror = function () { setStatus('No se pudo leer el archivo.' + keep, true); };
    reader.onload = function () {
      try {
        var ds = P.parseWorkbook(window.XLSX, new Uint8Array(reader.result), file.name);
        if (!ds.records.length) throw new Error('La hoja de detalle no contiene registros.');
        setDataset(ds, 'local');
        setStatus('Archivo cargado: ' + file.name + ' (' + F.int(ds.records.length) + ' registros). Los datos no salieron de este navegador.');
      } catch (e) {
        setStatus('Error de formato: ' + e.message + keep, true);
      }
      ev.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  function exportDataset() {
    if (!state.dataset) return;
    if (!(window.crypto && crypto.subtle)) { setStatus('La exportación requiere un contexto seguro (https o localhost).', true); return; }
    var salt = new Uint8Array(32); crypto.getRandomValues(salt);
    var enc = new TextEncoder();
    function hash(p) {
      var data = enc.encode(String(p)), buf = new Uint8Array(salt.length + data.length);
      buf.set(salt); buf.set(data, salt.length);
      return crypto.subtle.digest('SHA-256', buf).then(function (h) {
        return Array.from(new Uint8Array(h)).slice(0, 8).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    var src = state.dataset;
    // Si los datos ya están anonimizados, se conservan los hashes existentes (sin re-hash ni eliminaciones).
    var p = P.toCompact(src, src.meta.anonymized ? function (x) { return Promise.resolve(x); } : hash);
    p.then(function (compact) {
      if (compact.rows.length !== src.records.length) throw new Error('el número de registros exportados no coincide con los cargados');
      var blob = new Blob([JSON.stringify(compact)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'dataset.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      setStatus('dataset.json descargado con ' + F.int(compact.rows.length) + ' registros (todos los cargados, incluidos los excluidos de los cálculos). Reemplaza data/dataset.json en el repositorio y publica (ver README).');
      state.lastExport = compact.rows.length;
    }).catch(function (e) { setStatus('No se pudo exportar: ' + e.message, true); });
  }

  function setDataset(ds, kind) {
    state.dataset = ds;
    state.sourceKind = kind;
    state.model = M.prepare(ds);
    CH.setPartialDays(state.model.partial);
    $('btnExport').disabled = false;
    buildFilterControls();
    resetFilters();
  }

  // ---------------- filtros ----------------
  function allDepts() {
    var d = CONFIG.departments.slice();
    if (state.model.qa.unclassifiedTotal) d.push(M.UNCLASSIFIED);
    return d;
  }

  function buildFilterControls() {
    var model = state.model;
    var chips = allDepts().map(function (d) {
      var n = (model.qa.byDept[d] || {}).total || 0;
      return '<label class="chip"><input type="checkbox" value="' + esc(d) + '" checked><span>' + esc(d) + '<small>' + F.int(n) + '</small></span></label>';
    }).join('');
    $('fDepts').innerHTML = chips;
    var opts = '<option value="">Todos</option>' + model.months.map(function (m) { return '<option value="' + m + '">' + monthName(m) + '</option>'; }).join('');
    $('fMonth').innerHTML = opts;
    $('fMonthFrom').innerHTML = '<option value="">Desde</option>' + model.months.map(function (m) { return '<option value="' + m + '">' + monthName(m) + '</option>'; }).join('');
    $('fMonthTo').innerHTML = '<option value="">Hasta</option>' + model.months.map(function (m) { return '<option value="' + m + '">' + monthName(m) + '</option>'; }).join('');
    var first = model.days[0] || '', last = model.days[model.days.length - 1] || '';
    ['fFrom', 'fTo'].forEach(function (id) { $(id).min = first; $(id).max = last; });
  }

  function buildCampaignList() {
    var f = state.filters, model = state.model;
    var html = '';
    allDepts().forEach(function (d) {
      if (f.depts && !f.depts.has(d)) return;
      var camps = model.campaignsByDept[d];
      if (!camps) return;
      html += '<p class="multiselect__group">' + esc(d) + '</p>';
      Object.keys(camps).sort().forEach(function (c) {
        var checked = !f.campaigns || f.campaigns.has(c);
        html += '<label><input type="checkbox" value="' + esc(c) + '"' + (checked ? ' checked' : '') + '>' + esc(c) + '<small>' + F.int(camps[c]) + '</small></label>';
      });
    });
    $('fCampList').innerHTML = html || '<p class="multiselect__group">Sin campañas para los departamentos seleccionados.</p>';
    updateCampaignButton();
  }

  function visibleCampaigns() {
    return Array.from($('fCampList').querySelectorAll('input[type=checkbox]')).map(function (i) { return i.value; });
  }
  function updateCampaignButton() {
    var f = state.filters;
    var vis = visibleCampaigns();
    var sel = f.campaigns ? vis.filter(function (c) { return f.campaigns.has(c); }).length : vis.length;
    $('fCampBtn').textContent = !f.campaigns || sel === vis.length ? 'Todas (' + vis.length + ')' : sel + ' de ' + vis.length + ' seleccionadas';
  }

  function resetFilters() {
    state.filters = { depts: new Set(allDepts()), campaigns: null, dateFrom: '', dateTo: '', month: '', monthFrom: '', monthTo: '' };
    Array.from($('fDepts').querySelectorAll('input')).forEach(function (i) { i.checked = true; });
    ['fFrom', 'fTo', 'fMonth', 'fMonthFrom', 'fMonthTo'].forEach(function (id) { $(id).value = ''; });
    buildCampaignList();
    refresh();
  }

  function readFilters() {
    var f = state.filters;
    f.depts = new Set(Array.from($('fDepts').querySelectorAll('input:checked')).map(function (i) { return i.value; }));
    f.dateFrom = $('fFrom').value; f.dateTo = $('fTo').value;
    f.month = $('fMonth').value; f.monthFrom = $('fMonthFrom').value; f.monthTo = $('fMonthTo').value;
  }

  function bindFilters() {
    $('fDepts').addEventListener('change', function () { readFilters(); buildCampaignList(); refresh(); });
    ['fFrom', 'fTo', 'fMonth', 'fMonthFrom', 'fMonthTo'].forEach(function (id) {
      $(id).addEventListener('change', function () { readFilters(); refresh(); });
    });
    $('fCampList').addEventListener('change', function () {
      var vis = visibleCampaigns();
      var checked = Array.from($('fCampList').querySelectorAll('input:checked')).map(function (i) { return i.value; });
      state.filters.campaigns = checked.length === vis.length ? null : new Set(checked);
      updateCampaignButton(); refresh();
    });
    $('fCampPanel').addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      state.filters.campaigns = act === 'all' ? null : new Set();
      buildCampaignList(); refresh();
    });
    $('fCampBtn').addEventListener('click', function () {
      var p = $('fCampPanel'), open = p.hidden;
      p.hidden = !open; $('fCampBtn').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (!$('fCamp').contains(e.target)) { $('fCampPanel').hidden = true; $('fCampBtn').setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('fCampPanel').hidden) { $('fCampPanel').hidden = true; $('fCampBtn').setAttribute('aria-expanded', 'false'); $('fCampBtn').focus(); }
    });
    $('btnReset').addEventListener('click', resetFilters);
    $('fileInput').addEventListener('change', onFile);
    var upl = document.querySelector('label[for="fileInput"]');
    upl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
    $('btnExport').addEventListener('click', exportDataset);
  }

  // ---------------- pestañas ----------------
  function bindTabs() {
    var tabs = Array.from(document.querySelectorAll('.tab'));
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { activate(t.dataset.tab, true); });
      t.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1;
        if (j >= 0) { e.preventDefault(); tabs[j].focus(); activate(tabs[j].dataset.tab, true); }
      });
    });
    var h = location.hash.replace('#', '');
    if (TABS.indexOf(h) >= 0) state.activeTab = h;
    window.addEventListener('hashchange', function () {
      var k = location.hash.replace('#', '');
      if (TABS.indexOf(k) >= 0 && k !== state.activeTab) activate(k, false);
    });
  }

  function activate(tab, updateHash) {
    state.activeTab = tab;
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    });
    TABS.forEach(function (t) { $('panel-' + t).hidden = t !== tab; });
    $('controls').hidden = tab === 'metodologias';
    if (updateHash && history.replaceState) history.replaceState(null, '', '#' + tab);
    if (state.model && state.dirty[tab]) renderTab(tab);
    else resizeCharts(tab);
  }

  // ---------------- render ----------------
  function refresh() {
    if (!state.model) return;
    state.recs = M.applyFilters(state.model, state.filters);
    renderHeader();
    TABS.forEach(function (t) { state.dirty[t] = true; });
    renderTab(state.activeTab);
  }

  function periodText(recs) {
    var days = Array.from(new Set(recs.map(function (r) { return r.day; }).filter(Boolean))).sort();
    if (!days.length) return '| Período: sin datos para los filtros seleccionados';
    var a = days[0], b = days[days.length - 1];
    var txt = '| Período: ' + fmtDate(a) + ' – ' + fmtDate(b);
    var notes = [];
    [a, b].filter(function (d, i, arr) { return arr.indexOf(d) === i; }).forEach(function (d) {
      var p = state.model.partial[d];
      if (p) notes.push(fmtDate(d) + '* parcial, ' + (p.type === 'end' ? 'corte ' : 'inicio ') + p.cut);
    });
    return txt + (notes.length ? ' (' + notes.join('; ') + ')' : '');
  }

  function renderHeader() {
    $('periodLabel').textContent = periodText(state.recs);
    var meta = state.model.meta;
    var src = state.sourceKind === 'local' ? 'Excel cargado en este navegador' : 'Dataset integrado (anonimizado)';
    $('sourceLabel').textContent = src + ': ' + (meta.fileName || '—') + ' · ' + F.int(state.model.qa.totalFile) + ' registros en el archivo · ' +
      F.int(state.recs.length) + ' en la selección actual' + (meta.loadedAt ? ' · generado ' + meta.loadedAt.slice(0, 16).replace('T', ' ') : '');
    document.title = 'Dashboard operativo — SAC, Cobros, Crédito y Ventas ' + periodText(state.recs);
  }

  function alertItems() {
    var qa = state.model.qa, items = [];
    Object.keys(qa.partial).forEach(function (d) {
      var p = qa.partial[d];
      items.push(fmtDate(d) + '* es un día parcial: ' + (p.type === 'end' ? 'último registro a las ' + p.cut + '; el cierre más temprano de los días comparables es ' + p.reference + '.'
        : 'primer registro a las ' + p.cut + '; el inicio más tardío de los días comparables es ' + p.reference + '.'));
    });
    if (!(qa.byDept['Crédito'] || {}).total) items.push('Crédito: la tabla «Campaña → Departamento» no asigna ninguna campaña a Crédito; sus indicadores no pueden calcularse con este archivo.');
    if (qa.excludedTotal) items.push(F.int(qa.excludedTotal) + ' registros excluidos por campañas marcadas «No tomar en cuenta» (' + Object.keys(qa.excludedByCampaign).map(function (c) { return c + ': ' + qa.excludedByCampaign[c]; }).join(', ') + ').');
    if (qa.unclassifiedTotal) items.push(F.int(qa.unclassifiedTotal) + ' registros de campañas sin departamento en la tabla: ' + qa.unmappedCampaigns.join(', ') + '. Se muestran como «Sin clasificar».');
    var ld = qa.longDurations, nLong = ld.we + ld.wa + ld.wc;
    if (nLong) items.push(F.int(nLong) + ' duraciones superiores a 2 h excluidas de promedios y percentiles (se mantienen en los conteos).');
    qa.mappingIssues.concat(qa.parserIssues).forEach(function (m) { items.push(m); });
    if (!qa.reconciled) items.push('La suma por departamento no reconcilia con el total del archivo. Revisa la metodología de General.');
    return items;
  }


  function disposeCharts(tab) {
    (state.charts[tab] || []).forEach(function (c) { c.ro && c.ro.disconnect(); c.inst.dispose(); });
    state.charts[tab] = [];
  }
  function resizeCharts(tab) { (state.charts[tab] || []).forEach(function (c) { c.inst.resize(); }); }

  function renderTab(tab) {
    if (tab === 'metodologias') { $('metodoBody').innerHTML = renderMetodologias(); state.dirty[tab] = false; return; }
    var panel = $('panel-' + tab);
    disposeCharts(tab);
    var r = { general: renderGeneral, sac: renderSAC, ventas: renderVentas, cobros: renderCobros }[tab];
    var spec = r(state.recs);
    panel.innerHTML = spec.html;
    state.charts[tab] = spec.charts.map(function (c) {
      var el = document.getElementById(c.id);
      var inst = echarts.init(el, null, { renderer: 'canvas' });
      inst.setOption(c.option);
      var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { inst.resize(); }) : null;
      if (ro) ro.observe(el);
      return { inst: inst, ro: ro };
    });
    if (spec.after) spec.after(panel);
    state.dirty[tab] = false;
  }

  // ---------- piezas de HTML ----------
  function kpi(label, value, sub, opts) {
    opts = opts || {};
    return '<article class="kpi' + (opts.primary ? ' kpi--primary' : '') + '">' +
      (opts.alert ? '<span class="dot" role="img" aria-label="Aviso" title="' + esc(opts.alert) + '"></span>' : '') +
      '<h3 class="kpi__label">' + esc(label) + '</h3><p class="kpi__value">' + value + '</p>' +
      (sub ? '<p class="kpi__sub">' + sub + '</p>' : '') + '</article>';
  }
  var chartSeq = 0;
  function chartCard(list, title, note, option, wide) {
    var id = 'ch' + (++chartSeq);
    list.push({ id: id, option: option });
    return '<figure class="chart' + (wide ? ' chart--wide' : '') + '"><figcaption><h3 class="chart__title">' + esc(title) + '</h3>' +
      '<p class="chart__note">' + (note || '') + '</p></figcaption><div class="chart__body" id="' + id + '" role="img" aria-label="' + esc(title) + '"></div></figure>';
  }
  function head(icon, title, universe, extra) {
    return '<div class="panel-head"><span class="dept-icon" aria-hidden="true"><svg><use href="#' + icon + '"/></svg></span><h2>' + esc(title) + '</h2>' +
      (extra || '') + '<p class="universe">' + universe + '</p></div>';
  }
  function list(items) { return '<ul>' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'; }
  function table(headers, rows, numCols) {
    numCols = numCols || [];
    return '<div class="table-scroll"><table><thead><tr>' + headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) { return '<td' + (numCols.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function b(v) { return '<b>' + v + '</b>'; }
  function days(ax) { return ax.days.map(CH.dayLabel); }
  function hours(ax) { return ax.hours.map(CH.hourLabel); }
  function partialNote(ax) {
    var p = ax.days.filter(function (d) { return state.model.partial[d]; });
    return p.length ? '* día parcial (' + p.map(function (d) { return CH.dayLabel(d).replace('*', '') + ', ' + (state.model.partial[d].type === 'end' ? 'corte ' : 'inicio ') + state.model.partial[d].cut; }).join('; ') + ')' : '';
  }
  function join() { return Array.prototype.filter.call(arguments, Boolean).join(' · '); }
  function filtersSummary() {
    var f = state.filters, parts = [];
    parts.push('Departamentos: ' + (f.depts ? Array.from(f.depts).join(', ') : 'todos'));
    parts.push('Campañas: ' + (f.campaigns ? f.campaigns.size + ' seleccionadas' : 'todas'));
    if (f.dateFrom || f.dateTo) parts.push('Fechas: ' + (fmtDate(f.dateFrom) || 'inicio') + ' a ' + (fmtDate(f.dateTo) || 'fin'));
    if (f.month) parts.push('Mes: ' + monthName(f.month));
    if (f.monthFrom || f.monthTo) parts.push('Meses: ' + (f.monthFrom ? monthName(f.monthFrom) : 'inicio') + ' a ' + (f.monthTo ? monthName(f.monthTo) : 'fin'));
    return parts.join(' · ');
  }

  function nsTable(sl) {
    var thr = CONFIG.slThresholdSec, low = CONFIG.findingsMinN;
    var h = '<section class="ns-table" aria-label="Nivel de servicio por campaña"><h3 class="findings__title">Nivel de servicio por campaña</h3>' +
      '<p class="findings__note ns-table__lead">Atendidas con espera ≤' + thr + ' s / total de atendidas × 100. Los totales suman conteos de las campañas; no promedian porcentajes.</p>';
    if (!sl.depts.length) return h + '<p class="findings__note">Sin llamadas entrantes ofrecidas para los filtros seleccionados.</p></section>';
    function pa(o) { return F.pct(o.ofrecidas ? o.abandonadas / o.ofrecidas * 100 : null); }
    var rows = [];
    sl.depts.forEach(function (d) {
      rows.push('<tr class="is-group"><th scope="row">' + esc(d.dept) + '</th><td class="num">' + F.int(d.ofrecidas) + '</td><td class="num">' + F.int(d.atendidas) +
        '</td><td class="num">' + F.int(d.sl20) + '</td><td class="num"><b>' + F.pct(d.ns) + '</b></td><td class="num">' + pa(d) + '</td></tr>');
      d.rows.forEach(function (r) {
        var flag = r.atendidas > 0 && r.atendidas < low ? ' <span class="ns-low" title="Menos de ' + low + ' atendidas: porcentaje poco representativo">volumen bajo</span>' : '';
        rows.push('<tr><td class="ns-camp">' + esc(r.campaign) + '</td><td class="num">' + F.int(r.ofrecidas) + '</td><td class="num">' + F.int(r.atendidas) +
          '</td><td class="num">' + F.int(r.sl20) + '</td><td class="num">' + F.pct(r.ns) + flag + '</td><td class="num">' + pa(r) + '</td></tr>');
      });
    });
    rows.push('<tr class="is-total"><th scope="row">Total entrante</th><td class="num">' + F.int(sl.total.ofrecidas) + '</td><td class="num">' + F.int(sl.total.atendidas) +
      '</td><td class="num">' + F.int(sl.total.sl20) + '</td><td class="num"><b>' + F.pct(sl.total.ns) + '</b></td><td class="num">' + pa(sl.total) + '</td></tr>');
    return h + '<div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Departamento / campaña</th><th scope="col">Ofrecidas</th><th scope="col">Atendidas</th>' +
      '<th scope="col">Atendidas ≤' + thr + ' s</th><th scope="col">Nivel de servicio</th><th scope="col">% abandono</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></section>';
  }

  function findingsBlock(list, area) {
    var h = '<section class="findings" aria-label="Hallazgos operativos ' + esc(area) + '"><h3 class="findings__title">Hallazgos operativos</h3>';
    if (!list.length) {
      return h + '<p class="findings__note">La selección actual no alcanza el volumen mínimo (' + CONFIG.findingsMinN +
        ' llamadas por franja, día o agente) para sustentar hallazgos. Amplía los filtros.</p></section>';
    }
    h += '<div class="findings__grid">' + list.map(function (x) {
      return '<article class="finding"><h4>' + esc(x.title) + '</h4><p class="finding__evidence"><b>Dato:</b> ' + esc(x.evidence) +
        '</p><p class="finding__impl"><b>Implicación:</b> ' + esc(x.implication) + '</p><p class="finding__basis">Base: ' + esc(x.basis) + '</p></article>';
    }).join('') + '</div>';
    if (list.length < 4) h += '<p class="findings__note">Solo ' + list.length + ' hallazgo(s) tienen sustento suficiente con la selección actual; no se completan con datos no disponibles.</p>';
    return h + '</section>';
  }

  var COMMON_RULES = [
    'Clasificación por la tabla «Campaña → Departamento» del propio Excel; cada registro recibe un único departamento.',
    'Campañas marcadas «No tomar en cuenta» se excluyen por completo antes de cualquier cálculo.',
    'Duraciones superiores a 2 h (' + F.int(CONFIG.maxDurationSec) + ' s) se excluyen de promedios, medianas y percentiles, pero se cuentan en los volúmenes.',
    'Valores nulos o «N/A» no se convierten en cero; la métrica que dependa de ellos se omite y se informa.',
    'Percentiles y medianas con interpolación lineal (equivalente a PERCENTIL.INC de Excel).',
    'Los porcentajes se calculan sobre conteos del período filtrado; nunca se promedian ni suman porcentajes.'
  ];

  // ---------------- General ----------------
  function renderGeneral(recs) {
    var g = M.computeGeneral(recs), qa = state.model.qa, charts = [];
    var credit = (qa.byDept['Crédito'] || {}).total;
    var html = head('i-general', 'Vista general', 'Universo: todos los registros clasificados en SAC, Ventas, Cobros y Crédito según los filtros. ' + esc(filtersSummary()));
    // Orden solicitado; cada tarjeta conserva su tamaño (las principales siguen siendo φ veces más anchas)
    html += '<div class="kpis kpis--general">' +
      kpi('Entrantes ofrecidas', F.int(g.inb.ofrecidas), join(F.int(g.entrantes) + ' entrantes', F.int(g.inb.sinCola) + ' sin ingreso a cola'), { primary: true }) +
      kpi('% abandono entrante', F.pct(g.inb.pctAb), F.int(g.inb.abandonadas) + ' abandonadas / ' + F.int(g.inb.ofrecidas) + ' ofrecidas') +
      kpi('Nivel de servicio entrante (≤' + CONFIG.slThresholdSec + ' s)', F.pct(g.inb.ns), F.int(g.inb.sl20) + ' de ' + F.int(g.inb.atendidas) + ' atendidas') +
      kpi('Intentos salientes', F.int(g.out.intentos), join('Manual ' + b(F.int(g.outModes.Manual)), 'Marcador ' + b(F.int(g.outModes['Marcación'])),
        g.outModes.otro ? 'Sin modo ' + F.int(g.outModes.otro) : ''), { primary: true }) +
      kpi('% conexión saliente', F.pct(g.out.pctCon), F.int(g.out.con) + ' conectadas / ' + F.int(g.out.intentos) + ' intentos') +
      kpi('Registros analizados', F.int(g.total), join(F.int(g.entrantes) + ' entrantes', F.int(g.salientes) + ' salientes'),
        { alert: credit ? '' : 'Crédito sin campañas asignadas en la tabla del Excel' }) +
      '</div>';
    var pn = partialNote(g.ax);
    html += '<div class="charts">' +
      chartCard(charts, 'Registros por departamento y dirección', 'Registros (entrantes + salientes)' + (credit ? '' : ' · Crédito: 0 registros clasificados'), CH.deptVolume(g.perDept)) +
      chartCard(charts, 'Registros por fecha y departamento', join('Registros por día', pn), CH.deptByDay(g.dayDept, g.depts, days(g.ax))) +
      chartCard(charts, 'Entrantes por fecha: atendidas, abandonadas y % abandono', join('Llamadas ofrecidas; % sobre ofrecidas', pn), CH.inboundSeries(g.inb.byDay, days(g.ax))) +
      chartCard(charts, 'Salientes por fecha: resultado del intento y % conexión', join('Intentos; % conexión = conectadas / intentos', pn), CH.outboundStatus(g.outDay, days(g.ax))) +
      chartCard(charts, 'Distribución por hora: entrantes ofrecidas e intentos salientes', 'Llamadas por hora de inicio', CH.hourVolume(g.hour)) +
      chartCard(charts, 'Indicadores por departamento: % abandono entrante y % conexión saliente', 'Cada porcentaje usa su propio universo; no se suman', CH.deptRates(g.perDept)) +
      '</div>';
    html += nsTable(M.serviceLevelByCampaign(recs));
    html += findingsBlock(FN.general(recs, g), 'consolidados');
    return { html: html, charts: charts };
  }

  function deptTable() {
    var qa = state.model.qa;
    var rows = Object.keys(qa.byDept).filter(function (d) { return d !== M.UNCLASSIFIED || qa.byDept[d].total; }).map(function (d) {
      var x = qa.byDept[d];
      return [esc(d), F.int(x.E), F.int(x.S), F.int(x.total)];
    });
    rows.push(['<b>Total clasificado</b>', '', '', '<b>' + F.int(qa.sumDept) + '</b>']);
    var camp = [];
    state.model.mapping.forEach(function (v) { camp.push([esc(v.campaign), esc(v.dept === '__EXCLUDED__' ? CONFIG.excludeLabel : v.dept)]); });
    return table(['Departamento', 'Entrantes', 'Salientes', 'Total'], rows, [1, 2, 3]) +
      '<p>Archivo completo, sin filtros. Tabla de campañas aplicada (hoja «' + esc(state.model.meta.mappingSheet || '—') + '»):</p>' + table(['Campaña', 'Departamento'], camp);
  }

  // ---------------- SAC / Crédito ----------------
  function renderSAC(recs) {
    var hasCredit = !!((state.model.qa.byDept['Crédito'] || {}).total);
    if (!hasCredit) state.creditView = 'SAC';
    var dept = state.creditView, charts = [];
    var v = M.computeInboundView(recs, dept, recs);
    var seg = '<div class="segmented" role="group" aria-label="Línea entrante">' +
      '<button type="button" data-view="SAC" aria-pressed="' + (dept === 'SAC') + '">SAC</button>' +
      '<button type="button" data-view="Crédito" aria-pressed="' + (dept === 'Crédito') + '"' + (hasCredit ? '' : ' disabled title="La tabla Campaña → Departamento no asigna campañas a Crédito"') + '>Crédito</button></div>';
    var universe = 'Universo: llamadas entrantes de ' + dept + ' (' + F.int(v.total) + ' registros; ' + F.int(v.ofrecidas) + ' ofrecidas). ' + esc(filtersSummary());
    var html = head(dept === 'SAC' ? 'i-sac' : 'i-credito', 'Operativa ' + dept, universe, seg);
    var sixth;
    if (dept === 'SAC') {
      sixth = kpi('Transferencias', F.int(v.transfers.n), join(F.pct(v.transfers.pct) + ' de atendidas', F.int(v.transfers.ok) + ' con «Tr. Ok» = Si'));
    } else if (v.outbound && v.outbound.intentos) {
      sixth = kpi('Salientes de Crédito', F.int(v.outbound.intentos), '% conexión ' + b(F.pct(v.outbound.pctCon)) + ' (' + F.int(v.outbound.con) + ' conectadas)');
    } else {
      sixth = kpi('Salientes de Crédito', '—', 'No disponible: no hay llamadas salientes de Crédito en la selección.', { alert: 'Sin datos salientes de Crédito' });
    }
    var abSub = 'Cliente ' + b(F.pct(v.pctAbCli)) + ' (' + F.int(v.abCliente) + ') · Sistema ' + b(F.pct(v.pctAbSis)) + ' (' + F.int(v.abSistema) + ')' +
      (v.abOtro ? ' · Sin determinar ' + F.int(v.abOtro) : '');
    html += '<div class="kpis">' +
      kpi('Ofrecidas', F.int(v.ofrecidas), join(F.int(v.atendidas) + ' atendidas', F.int(v.abandonadas) + ' abandonadas', v.sinCola ? F.int(v.sinCola) + ' entrantes sin ingreso a cola' : ''), { primary: true }) +
      kpi('% abandono', F.pct(v.pctAb), abSub, { primary: true }) +
      kpi('Nivel de servicio (≤' + CONFIG.slThresholdSec + ' s)', F.pct(v.ns), F.int(v.sl20) + ' de ' + F.int(v.atendidas) + ' atendidas') +
      kpi('Espera promedio (atendidas)', F.sec(v.wait.mean), 'P90 ' + b(F.sec(v.wait.p90)) + ' · ' + F.int(v.wait.n) + ' esperas válidas',
        { alert: v.wait.excluded ? F.int(v.wait.excluded) + ' esperas > 2 h excluidas' : '' }) +
      kpi('Conversación promedio', F.min(v.talk.mean), 'Mediana ' + b(F.min(v.talk.median)) + ' · ' + F.int(v.talk.n) + ' válidas',
        { alert: (v.talk.excluded || v.talk.zeros) ? join(v.talk.excluded ? F.int(v.talk.excluded) + ' > 2 h excluidas' : '', v.talk.zeros ? F.int(v.talk.zeros) + ' con 0 s no medidas' : '') : '' }) +
      sixth + '</div>';
    var pn = partialNote(v.ax);
    var hourOpts = {};
    if (dept === 'Crédito' && v.sacRefAvailable) { hourOpts.reference = v.sacRefByHour; hourOpts.referenceName = '% abandono SAC (referencia)'; }
    var ag = v.agents;
    html += '<div class="charts">' +
      chartCard(charts, 'Embudo: ofrecidas → atendidas → atendidas en ≤' + CONFIG.slThresholdSec + ' s', 'Llamadas; % sobre ofrecidas',
        CH.funnel([{ name: 'Ofrecidas', value: v.ofrecidas }, { name: 'Atendidas', value: v.atendidas }, { name: 'Atendidas en ≤' + CONFIG.slThresholdSec + ' s', value: v.sl20 }])) +
      chartCard(charts, 'Por fecha: atendidas, abandonadas y % abandono', join('Llamadas ofrecidas; % sobre ofrecidas', pn), CH.inboundSeries(v.byDay, days(v.ax))) +
      chartCard(charts, 'Mapa de calor: % abandono por día de la semana y hora', '«—» = menos de ' + CONFIG.heatmapMinCalls + ' ofrecidas en la celda', CH.heatmap(v.heat, v.ax.hours)) +
      chartCard(charts, 'Por hora: atendidas, abandonadas y % abandono', dept === 'Crédito' ? (v.sacRefAvailable ? 'Línea punteada: % abandono SAC con los mismos filtros' : 'Sin datos SAC comparables para referencia') : 'Hora de inicio de la llamada',
        CH.inboundSeries(v.byHour, hours(v.ax), hourOpts)) +
      chartCard(charts, 'Tramos de espera: atendidas vs. abandonadas', 'Segundos de «Tiempo Esp.»', CH.waitBuckets(v.buckets)) +
      chartCard(charts, 'Por agente: atendidas y conversación promedio', 'Último agente de la llamada atendida; conversación en minutos', CH.agentsInbound(ag)) +
      '</div>';
    html += findingsBlock(FN.inbound(recs.filter(function (r) { return r.dept === dept && r.d === 'E'; }), v, dept), dept);
    return { html: html, charts: charts, after: function (panel) {
      panel.querySelectorAll('.segmented button').forEach(function (bt) {
        bt.addEventListener('click', function () { if (bt.disabled) return; state.creditView = bt.dataset.view; renderTab('sac'); });
      });
    } };
  }

  // ---------------- Ventas ----------------
  function renderVentas(recs) {
    var v = M.computeVentas(recs, recs), charts = [];
    var mar = v.modes['Marcación'];
    var html = head('i-ventas', 'Operativa Ventas', 'Universo: llamadas salientes de Ventas (' + F.int(v.base.intentos) + ' intentos). ' + esc(filtersSummary()));
    html += '<div class="kpis">' +
      kpi('Intentos', F.int(v.base.intentos), join('Manual ' + b(F.int(v.modes.Manual.intentos)), 'Marcador ' + b(F.int(mar.intentos))), { primary: true }) +
      kpi('Números gestionados únicos', F.int(v.unicos), (v.intentosPorNumero == null ? '—' : new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 2 }).format(v.intentosPorNumero)) + ' intentos por número', { primary: true }) +
      kpi('% conexión', F.pct(v.base.pctCon), F.int(v.base.con) + ' conectadas / ' + F.int(v.base.intentos) + ' intentos') +
      kpi('% abandono del marcador', F.pct(v.pctAbMarc), F.int(mar.abMarc) + ' / (' + F.int(mar.con) + ' conectadas + ' + F.int(mar.abMarc) + ' abandonos) en marcador') +
      kpi('Gestión tipificada / intentos', F.pct(v.pctTip), F.int(v.tipificada) + ' registros con tipificación válida') +
      kpi('Conversación promedio', F.min(v.talk.mean), 'Mediana ' + b(F.min(v.talk.median)) + ' · ' + F.int(v.talk.n) + ' válidas',
        { alert: (v.talk.zeros || v.talk.excluded) ? join(v.talk.zeros ? F.int(v.talk.zeros) + ' conectadas con 0 s no medidas' : '', v.talk.excluded ? F.int(v.talk.excluded) + ' > 2 h excluidas' : '') : '' }) +
      '</div>';
    var pn = partialNote(v.ax);
    var agents = v.byAgent;
    html += '<div class="charts">' +
      chartCard(charts, 'Embudo: intentos → contestadas → con agente → tipificada → seguimiento', 'Etapas anidadas; % sobre intentos', CH.funnel(v.funnel)) +
      chartCard(charts, 'Por fecha: conectadas, abandonos del marcador y no conectadas', join('Intentos; % conexión = conectadas / intentos', pn), CH.outboundStatus(v.byDay, days(v.ax), { palette: CH.SALES_STATUS_PALETTE })) +
      chartCard(charts, 'Resultados de las conectadas por tipificación agrupada', 'Conectadas (con agente) según «Disp. Abs.»', CH.salesGroups(v.groups)) +
      chartCard(charts, 'Por hora: resultado del intento y % conexión', 'Hora de inicio del intento', CH.outboundStatus(v.byHour, hours(v.ax))) +
      chartCard(charts, 'Por campaña: resultado del intento y % conexión', 'Intentos por campaña de Ventas', CH.outboundStatus(v.byCampaign, v.byCampaign.map(function (c) { return c.key; }), { wrap: v.byCampaign.length > 4 ? 55 : 89 })) +
      chartCard(charts, 'Por agente: resultado del intento y conversación promedio', 'Primer agente; conversación en minutos', CH.outboundAgents(agents)) +
      '</div>';
    html += findingsBlock(FN.ventas(recs.filter(function (r) { return r.dept === 'Ventas' && r.d === 'S'; }), v), 'Ventas');
    return { html: html, charts: charts };
  }

  // ---------------- Cobros (sin tipificaciones ni resultados de contacto) ----------------
  function renderCobros(recs) {
    var c = M.computeCobros(recs, recs), charts = [];
    var man = c.modes.Manual, mar = c.modes['Marcación'], inb = c.inb;
    var html = head('i-cobros', 'Operativa Cobros', 'Universo: salientes manuales (' + F.int(man.intentos) + '), salientes por marcador (' + F.int(mar.intentos) +
      ') y línea entrante (' + F.int(inb.ofrecidas) + ' ofrecidas) de Cobros. ' + esc(filtersSummary()));
    var ipn = c.intentosPorNumero == null ? '—' : new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 2 }).format(c.intentosPorNumero);
    html += '<div class="kpis">' +
      kpi('Intentos salientes', F.int(c.base.intentos), join('Manual ' + b(F.int(man.intentos)), 'Marcador ' + b(F.int(mar.intentos)),
        c.modes.otro.intentos ? 'Sin modo ' + F.int(c.modes.otro.intentos) : ''), { primary: true }) +
      kpi('% conexión', F.pct(c.base.pctCon), join('Manual ' + b(F.pct(man.pctCon)), 'Marcador ' + b(F.pct(mar.pctCon))), { primary: true }) +
      kpi('% abandono del marcador', F.pct(c.pctAbMarc), F.int(mar.abMarc) + ' / (' + F.int(mar.con) + ' conectadas + ' + F.int(mar.abMarc) + ' abandonos)') +
      kpi('Números gestionados únicos', F.int(c.unicos), ipn + ' intentos por número') +
      kpi('Conversación promedio', F.min(c.talk.mean), 'Mediana ' + b(F.min(c.talk.median)) + ' · ' + F.int(c.talk.n) + ' válidas',
        { alert: (c.talk.excluded || c.talk.zeros) ? join(c.talk.excluded ? F.int(c.talk.excluded) + ' > 2 h excluidas' : '', c.talk.zeros ? F.int(c.talk.zeros) + ' con 0 s no medidas' : '') : '' }) +
      kpi('% abandono línea entrante', F.pct(inb.pctAb), F.int(inb.abandonadas) + ' de ' + F.int(inb.ofrecidas) + ' ofrecidas') +
      '</div>';
    var pn = partialNote(c.ax);
    function outFunnel(m) { return [{ name: 'Intentos', value: m.intentos }, { name: 'Contestadas', value: m.contestadas }, { name: 'Con agente', value: m.con }]; }
    html += '<div class="charts">' +
      chartCard(charts, 'Embudo manual: intentos → contestadas → con agente', 'Salientes manuales; % sobre intentos', CH.funnel(outFunnel(man))) +
      chartCard(charts, 'Embudo del marcador: intentos → contestadas → con agente', 'Salientes por marcador; % sobre intentos', CH.funnel(outFunnel(mar))) +
      chartCard(charts, 'Embudo línea entrante: ofrecidas → atendidas → ≤' + CONFIG.slThresholdSec + ' s', 'Entrantes de Cobros; % sobre ofrecidas',
        CH.funnel([{ name: 'Ofrecidas', value: inb.ofrecidas }, { name: 'Atendidas', value: inb.atendidas }, { name: 'Atendidas en ≤' + CONFIG.slThresholdSec + ' s', value: inb.sl20 }])) +
      chartCard(charts, 'Por fecha: intentos por modo y % conexión', join('Intentos salientes', pn), CH.modeSeries(c.byDay, days(c.ax), false)) +
      chartCard(charts, 'Por hora: intentos por modo y % conexión de cada modo', 'Línea continua: manual · punteada: marcador', CH.modeSeries(c.byHour, hours(c.ax), true)) +
      chartCard(charts, 'Top ' + CONFIG.topAgents + ' agentes por intentos, por modo de marcación', 'Primer agente del intento', CH.agentsByMode(c.topAgents)) +
      chartCard(charts, 'Línea entrante por fecha: atendidas, abandonadas y % abandono', join('Entrantes ofrecidas de Cobros; % sobre ofrecidas', pn), CH.inboundSeries(inb.byDay, days(c.ax)), true) +
      '</div>';
    html += findingsBlock(FN.cobros(recs.filter(function (r) { return r.dept === 'Cobros' && r.d === 'S'; }), c), 'Cobros');
    return { html: html, charts: charts };
  }

  // ---------------- Metodologías ----------------
  function integrityTable() {
    var qa = state.model.qa, ds = state.dataset, st = qa.parserStats || {};
    function ok(cond, txt) { return '<span class="' + (cond ? 'qa-ok' : 'qa-warn') + '">' + txt + '</span>'; }
    var read = st.rowsRead != null ? st.rowsRead : ds.records.length;
    var kept = ds.records.length;
    var rows = [
      ['Filas con datos en la hoja de detalle', F.int(read), ok(true, 'Hoja «' + esc(state.model.meta.detailSheet || '—') + '»' + (st.blankRows ? '; ' + F.int(st.blankRows) + ' filas totalmente vacías sin contenido' : ''))],
      ['Registros conservados tras la carga', F.int(kept), ok(kept === read, kept === read ? 'Igual a las filas leídas: no se eliminó ningún registro' : 'Diferencia con las filas leídas')],
      ['Registros en el dataset exportable', F.int(kept), ok(true, 'La exportación incluye todos los registros conservados')],
      ['Excluidos de los cálculos («No tomar en cuenta»)', F.int(qa.excludedTotal), ok(true, 'Se conservan en los datos; ' + (Object.keys(qa.excludedByCampaign).map(function (c) { return esc(c) + ': ' + qa.excludedByCampaign[c]; }).join(', ') || 'ninguno'))],
      ['Incluidos en los cálculos operativos', F.int(qa.included), ok(qa.included + qa.excludedTotal === kept, 'Incluidos + excluidos = conservados')],
      ['De ellos, sin departamento en la tabla', F.int(qa.unclassifiedTotal), ok(!qa.unclassifiedTotal, qa.unclassifiedTotal ? 'Visibles como «Sin clasificar»: ' + esc(qa.unmappedCampaigns.join(', ')) : 'Ninguno')],
      ['Visibles con los filtros actuales', F.int(state.recs.length), ok(true, 'Los filtros solo cambian la vista; no modifican los datos almacenados')],
      ['Duraciones > 2 h (espera / atención / conversación saliente)', F.int(qa.longDurations.we) + ' / ' + F.int(qa.longDurations.wa) + ' / ' + F.int(qa.longDurations.wc), ok(true, 'Registros conservados y contados; fuera solo de promedios y percentiles')],
      ['Identificadores duplicados', F.int(qa.duplicateIds), ok(!qa.duplicateIds, 'Se conservan; no se deduplica')],
      ['Registros sin fecha válida', F.int(qa.recordsWithoutDate), ok(!qa.recordsWithoutDate, 'Se conservan; quedan fuera de los filtros de fecha')],
      ['Clasificadas + excluidas = total del archivo', F.int(qa.sumDept) + ' + ' + F.int(qa.excludedTotal), ok(qa.reconciled, qa.reconciled ? 'Reconcilia con ' + F.int(qa.totalFile) : 'No reconcilia')]
    ];
    rows.push(
      ['Registros en más de un departamento', '0', ok(true, 'Imposible por construcción: un mapa campaña → departamento único')],
      ['Registros sin dirección (Ent./Sal.)', F.int(qa.recordsWithoutDirection), ok(!qa.recordsWithoutDirection, 'Se conservan')],
      ['Salientes con estado único (Aten./Ab./Canc.)', F.int(qa.outboundStates.ok), ok(!qa.outboundStates.none && !qa.outboundStates.multi, F.int(qa.outboundStates.none) + ' sin estado · ' + F.int(qa.outboundStates.multi) + ' con más de uno')],
      ['Ofrecidas sin «Aten.» ni «Ab.»', F.int(qa.inboundStates.ofrecidasSinEstado), ok(!qa.inboundStates.ofrecidasSinEstado, 'De ' + F.int(qa.inboundStates.ofrecidas) + ' ofrecidas')],
      ['Duraciones con formato no válido', F.int(st.invalidDurations || 0), ok(!st.invalidDurations, 'Se tratan como nulas; el registro se conserva')],
      ['Teléfonos con prefijo 506 normalizado (11 → 8 dígitos)', F.int(st.phonePrefixStripped || 0), ok(true, 'Solo para contar números únicos')],
      ['Días parciales confirmados', F.int(Object.keys(qa.partial).length), ok(true, Object.keys(qa.partial).map(function (d) { return fmtDate(d) + '* (corte ' + qa.partial[d].cut + ')'; }).join(', ') || 'Ninguno')]
    );
    if (state.lastExport != null) rows.push(['Registros en la última exportación', F.int(state.lastExport), ok(state.lastExport === kept, 'Comparado con los conservados')]);
    return table(['Control', 'Valor', 'Resultado'], rows, [1]);
  }

  function campaignsOf(dept) {
    var out = [];
    state.model.mapping.forEach(function (v) { if (v.dept === dept) out.push(v.campaign); });
    return out.length ? out.map(esc).join(', ') : 'ninguna';
  }

  function deptSection(icon, title, blocks) {
    return '<section class="metodo-sec"><div class="metodo-sec__head"><span class="dept-icon" aria-hidden="true"><svg><use href="#' + icon + '"/></svg></span><h3>' + esc(title) + '</h3></div>' +
      '<div class="method__body">' + '<div>' + blocks.left.join('') + '</div><div>' + blocks.right.join('') + '</div></div></section>';
  }
  function sub(title, body) { return '<section class="metodo-sub"><h4>' + esc(title) + '</h4>' + body + '</section>'; }

  function renderMetodologias() {
    var model = state.model, qa = model.qa;
    var all = M.applyFilters(model, {});
    var sac = M.computeInboundView(all, 'SAC', all), v = M.computeVentas(all, all), c = M.computeCobros(all, all);
    var cr = M.computeInboundView(all, 'Crédito', all);
    var sl = CONFIG.slThresholdSec, maxh = F.int(CONFIG.maxDurationSec);
    var src = state.sourceKind === 'local' ? 'Excel cargado en este navegador' : 'dataset integrado (anonimizado)';
    var html = '<p class="metodo-intro">Fuente: ' + esc(src) + ' «' + esc(model.meta.fileName || '—') + '». Las cifras de esta pestaña corresponden al archivo completo, sin filtros.</p>';

    var notes = alertItems();
    html += '<section class="metodo-sec"><div class="metodo-sec__head"><h3>Avisos de calidad de datos</h3></div>' +
      (notes.length ? '<ul class="alerts">' + notes.map(function (t) { return '<li><span class="dot" aria-hidden="true"></span><span>' + esc(t) + '</span></li>'; }).join('') + '</ul>' : '<p>Sin avisos.</p>') + '</section>';

    html += '<section class="metodo-sec"><div class="metodo-sec__head"><h3>Control de integridad de los registros</h3></div>' +
      '<div class="method__body"><div>' + integrityTable() + '</div><div>' + sub('Preservación de los datos', list([
        'Ningún registro se borra, descarta ni sobrescribe durante la carga, el filtrado o la exportación.',
        'Las campañas «No tomar en cuenta» permanecen en los datos y en la exportación; solo se excluyen de los cálculos operativos.',
        'Nulos, duplicados, inconsistencias y duraciones > 2 h se conservan; se aplican las reglas de cálculo sin eliminar registros.',
        'Si una carga falla (archivo vacío, inválido o incompatible), se conserva el último conjunto de datos válido y se muestra el motivo.',
        'Si una métrica no puede calcularse, se muestra «—» y se informa; los registros se conservan.',
        'Las filas totalmente vacías del Excel no contienen datos y no generan registros; se informan en el control.'
      ])) + sub('Nivel de servicio', '<p>Nivel de servicio = atendidas con «Tiempo Esp.» ≤ ' + sl + ' s / total de atendidas × 100. Se calcula por campaña de entrada y, para departamentos y total, sumando los conteos de sus campañas (nunca promediando porcentajes). Una campaña sin atendidas muestra «—»; con menos de ' + CONFIG.findingsMinN + ' atendidas se marca como volumen bajo.</p><p>El denominador son las atendidas: las llamadas abandonadas no entran en este indicador. Por eso se presenta junto al % de abandono (abandonadas / ofrecidas), en las tarjetas y en la tabla «Nivel de servicio por campaña» de General. Una atendida sin espera válida cuenta en el denominador y no en el numerador.</p>') + '</div></div></section>';

    html += '<section class="metodo-sec"><div class="metodo-sec__head"><h3>Clasificación por departamento y tabla de campañas</h3></div><div class="method__body"><div>' +
      deptTable() + '</div><div>' + sub('Criterio', list([
        'Cada campaña se asigna al departamento indicado en la tabla «Campaña → Departamento» del propio Excel; cada registro pertenece a un único departamento.',
        'Las campañas marcadas «' + CONFIG.excludeLabel + '» se conservan, pero se excluyen de los cálculos operativos.',
        'Las campañas que no figuran en la tabla se muestran como «Sin clasificar» y generan un aviso.'
      ])) + '</div></div></section>';

    html += deptSection('i-sac', 'SAC', {
      left: [
        sub('Objetivo y universo de datos', '<p>Medir la atención de llamadas entrantes de SAC: volumen ofrecido, abandono del cliente y del sistema, tiempos de espera y de conversación, transferencias y carga por agente.</p>' + list([
          'Campañas asignadas a SAC en la tabla del Excel: ' + campaignsOf('SAC') + '.',
          'Universo: registros SAC con «Inic.» = Ent. → ' + F.int(sac.total) + '; ofrecidas («Buscó agente» = Si): ' + F.int(sac.ofrecidas) + '; sin ingreso a cola: ' + F.int(sac.sinCola) + '.',
          'Las salientes de campañas SAC (' + F.int((qa.byDept.SAC || {}).S || 0) + ') solo se muestran en General.'
        ])),
        sub('Indicadores y fórmulas', table(['Indicador', 'Fórmula', 'Campo'], [
          ['Ofrecidas', 'entrantes con «Buscó agente» = Si', 'Buscó agente'],
          ['% abandono', 'abandonadas / ofrecidas × 100', 'Ab.'],
          ['% abandono cliente / sistema', 'abandonos de cada tipo / ofrecidas × 100', 'Ab., Finalizador'],
          ['Nivel de servicio (≤' + sl + ' s)', 'atendidas con espera ≤ ' + sl + ' s / total de atendidas × 100, por campaña y total', 'Aten., Tiempo Esp.'],
          ['Espera promedio y P90', 'media y percentil 90 (interpolación lineal) de esperas válidas de atendidas, en s', 'Tiempo Esp.'],
          ['Conversación promedio y mediana', 'sobre duraciones válidas de atendidas, en min', 'Tiempo atención'],
          ['Transferencias', 'atendidas con «Tr.» = Si; completadas: «Tr. Ok» = Si', 'Tr., Tr. Ok'],
          ['Mapa de calor', 'abandonadas / ofrecidas por día de semana y hora', 'Fecha de inicio']
        ]))
      ],
      right: [
        sub('Criterios de clasificación y agrupación', list([
          'Atendida: ofrecida con «Aten.» = Si. Abandonada: ofrecida con «Ab.» = Si.',
          'Abandono del sistema: finalizador «ACD timeout» (' + F.int(sac.abSistema) + '). Abandono del cliente: finalizador «Contacto» (' + F.int(sac.abCliente) + '). Otros finalizadores: sin determinar (' + F.int(sac.abOtro) + ').',
          'Tramos de espera: 0–10, 11–20, 21–30, 31–60, 61–90 y >90 s.',
          'Agente: «Último agente» de la llamada atendida.'
        ])),
        sub('Reglas de inclusión, exclusión y tratamiento', list([
          'Esperas > 2 h excluidas de estadísticas: ' + F.int(sac.wait.excluded) + '; conversaciones > 2 h: ' + F.int(sac.talk.excluded) + '. Se cuentan en los volúmenes.',
          'Conversaciones de 0 s se tratan como no medidas (' + F.int(sac.talk.zeros) + ').',
          'Celdas del mapa de calor con menos de ' + CONFIG.heatmapMinCalls + ' ofrecidas muestran «—».',
          'Tramos de espera sin dato válido: ' + F.int(sac.buckets.invalid.aten + sac.buckets.invalid.ab) + '. Ofrecidas sin «Aten.» ni «Ab.»: ' + F.int(sac.sinEstado) + '.'
        ])),
        sub('Supuestos y limitaciones', list([
          'El nivel de servicio no incluye abandonadas en su denominador; debe leerse junto al % de abandono.',
          'Una atendida sin espera válida cuenta en el denominador del nivel de servicio y no en el numerador (' + F.int(sac.atenSinEspera) + ' en el archivo).',
          'La clasificación de abandonos depende del finalizador registrado por inConcert.'
        ]))
      ]
    });

    var grpRows = [];
    var gd = v.groupDetail;
    function cnt(k) { return F.int(gd[k] ? gd[k].n : 0); }
    Object.keys(CONFIG.salesGroups.exactRules).forEach(function (k) { grpRows.push([esc(k), esc(CONFIG.salesGroups.exactRules[k]), cnt(k)]); });
    CONFIG.salesGroups.prefixRules.forEach(function (r) {
      var n = Object.keys(gd).filter(function (k) { return k.indexOf(r.prefix) === 0; }).reduce(function (a, k) { return a + gd[k].n; }, 0);
      grpRows.push([esc(r.prefix) + '…', esc(r.group), F.int(n)]);
    });
    var otras = Object.keys(gd).filter(function (k) { return gd[k].group === 'Otras tipificaciones (sin agrupar)'; });
    grpRows.push(['Cualquier otra tipificación' + (otras.length ? ' (' + otras.map(esc).join(', ') + ')' : ''), 'Otras tipificaciones (sin agrupar)', F.int(v.groups['Otras tipificaciones (sin agrupar)'] || 0)],
      ['Sin «Disp. Abs.» ni «Disp.»', 'Sin tipificación', F.int(v.groups['Sin tipificación'] || 0)]);
    html += deptSection('i-ventas', 'Ventas', {
      left: [
        sub('Objetivo y universo de datos', '<p>Medir la gestión saliente de Ventas: intentos, contactabilidad, abandono del marcador, tipificación de las gestiones y resultado de las conectadas.</p>' + list([
          'Campañas asignadas a Ventas: ' + campaignsOf('Ventas') + '.',
          'Universo: registros Ventas con «Inic.» = Sal. → ' + F.int(v.base.intentos) + ' intentos (manual ' + F.int(v.modes.Manual.intentos) + ', marcador ' + F.int(v.modes['Marcación'].intentos) + ').',
          'Las entrantes de campañas de Ventas (' + F.int((qa.byDept.Ventas || {}).E || 0) + ') solo se muestran en General.'
        ])),
        sub('Indicadores y fórmulas', table(['Indicador', 'Fórmula'], [
          ['Intentos', 'registros salientes'],
          ['Números gestionados únicos', 'valores distintos de «Dir.» normalizado'],
          ['% conexión', 'conectadas / intentos × 100'],
          ['% abandono del marcador', 'abandonos del marcador / (conectadas en marcador + abandonos del marcador) × 100'],
          ['Gestión tipificada / intentos', 'registros con tipificación válida / intentos × 100'],
          ['Intentos por número', 'intentos / números únicos'],
          ['Conversación promedio y mediana', '«Tiempo Conc.» válido de conectadas, en min']
        ]))
      ],
      right: [
        sub('Criterios de clasificación y agrupación', list([
          'Estados excluyentes: conectada («Aten.» = Si), abandono tras contestar («Ab.» = Si; del marcador si el modo es Marcación), no conectada («Canc.» = Si).',
          'Contestadas = conectadas + abandonos tras contestar. Embudo anidado: intentos → contestadas → con agente → con agente y tipificada → seguimiento.',
          'Tipificación válida: «Disp. Abs.» (o «Disp.») distinto de N/A o vacío.',
          'Agrupación de tipificaciones de las conectadas (literal, sin asignar por similitud):'
        ]) + table(['Tipificación', 'Grupo', 'Conectadas'], grpRows, [2])),
        sub('Reglas de inclusión, exclusión y tratamiento', list([
          'Teléfonos: solo dígitos; números de 11 dígitos con prefijo 506 se reducen a 8.',
          'Conversaciones > 2 h excluidas de estadísticas: ' + F.int(v.talk.excluded) + '; con 0 s no medidas: ' + F.int(v.talk.zeros) + '.'
        ])),
        sub('Supuestos y limitaciones', list([
          'En coocique_central, las salientes conectadas registran «Tiempo Conc.» = 0; la conversación de Ventas se calcula con ' + F.int(v.talk.n) + ' conectadas con duración medida.',
          'Registros tipificados sin conexión con agente: ' + F.int(v.tipNoCon) + ' (cuentan en «gestión tipificada», no en el embudo).',
          'Agente: «Primer agente» del intento; intentos sin agente: ' + F.int(v.sinAgente) + '. Intentos sin número: ' + F.int(v.sinNumero) + '.'
        ]))
      ]
    });

    html += deptSection('i-cobros', 'Cobros', {
      left: [
        sub('Objetivo y universo de datos', '<p>Medir la gestión de Cobros en tres universos separados: salientes manuales, salientes por marcador y línea entrante. Esta área no presenta tipificaciones, resultados de contacto, contacto efectivo ni compromisos.</p>' + list([
          'Campañas asignadas a Cobros: ' + campaignsOf('Cobros') + '.',
          'Salientes: manual ' + F.int(c.modes.Manual.intentos) + ', marcador ' + F.int(c.modes['Marcación'].intentos) + (c.modes.otro.intentos ? ', sin modo ' + F.int(c.modes.otro.intentos) : '') + '. Entrantes: ' + F.int(c.inb.total) + ' (' + F.int(c.inb.ofrecidas) + ' ofrecidas).'
        ])),
        sub('Indicadores y fórmulas', table(['Indicador', 'Fórmula'], [
          ['% conexión (total y por modo)', 'conectadas / intentos × 100 en cada universo'],
          ['% abandono del marcador', 'abandonos del marcador / (conectadas en marcador + abandonos del marcador) × 100'],
          ['Números únicos e intentos por número', 'valores distintos de «Dir.» normalizado; intentos / números únicos'],
          ['Conversación promedio y mediana', '«Tiempo Conc.» válido de conectadas, en min'],
          ['% abandono línea entrante', 'abandonadas / ofrecidas × 100'],
          ['Nivel de servicio (línea entrante)', 'atendidas con espera ≤ ' + sl + ' s / total de atendidas × 100']
        ]))
      ],
      right: [
        sub('Criterios de clasificación y agrupación', list([
          'Modo de marcación según «Tipo de Llamada saliente»; cada intento pertenece a un solo modo.',
          'Contestadas: «Aten.» = Si o «Ab.» = Si. Con agente: «Aten.» = Si.',
          'Top de agentes: ' + CONFIG.topAgents + ' agentes con más intentos («Primer agente»), apilados por modo.'
        ])),
        sub('Reglas de inclusión, exclusión y tratamiento', list([
          'Los denominadores de salientes manuales, marcador y entrantes no se mezclan.',
          'Conversaciones > 2 h excluidas de estadísticas: ' + F.int(c.talk.excluded) + '; con 0 s no medidas: ' + F.int(c.talk.zeros) + '; nulas: ' + F.int(c.talk.invalid) + '.',
          'Intentos sin número: ' + F.int(c.sinNumero) + '; sin agente: ' + F.int(c.sinAgente) + '.'
        ])),
        sub('Supuestos y limitaciones', list([
          'Las diferencias entre modos no prueban una causa: las bases asignadas a cada modo pueden ser distintas.',
          'El campo «Disp.» existe para Cobros, pero no se presenta por restricción de la vista.'
        ]))
      ]
    });

    var hasCr = cr.total > 0;
    html += deptSection('i-credito', 'Crédito', {
      left: [
        sub('Objetivo y universo de datos', '<p>Aplicar a las llamadas entrantes de Crédito la misma estructura de SAC y mostrar sus salientes con % de conexión.</p>' + list([
          'Campañas asignadas a Crédito: ' + campaignsOf('Crédito') + '.',
          hasCr ? 'Universo: ' + F.int(cr.total) + ' entrantes (' + F.int(cr.ofrecidas) + ' ofrecidas) y ' + F.int((qa.byDept['Crédito'] || {}).S || 0) + ' salientes.'
            : 'En el archivo cargado ninguna campaña está asignada a Crédito; sus indicadores no pueden calcularse. Las campañas con «credito» en el nombre están asignadas a Ventas por la tabla del Excel y no se reclasifican.'
        ])),
        sub('Indicadores y fórmulas', '<p>Los de SAC (ofrecidas, % abandono cliente/sistema, nivel de servicio ≤' + sl + ' s sobre atendidas, espera, conversación y mapa de calor). Sexta tarjeta: salientes de Crédito y su % de conexión (conectadas / intentos × 100), solo si ambos datos existen. Gráfico por hora: % abandono SAC como referencia con los mismos filtros.</p>')
      ],
      right: [
        sub('Criterios, reglas y limitaciones', list([
          'Se activa en la pestaña «Operativa SAC» (selector SAC / Crédito) cuando la tabla del Excel asigna campañas a Crédito.',
          'Mismas reglas de tratamiento que SAC (duraciones > 2 h, 0 s, mapa de calor con «—» bajo ' + CONFIG.heatmapMinCalls + ' ofrecidas).',
          'Los hallazgos de Crédito se presentan solo cuando hay volumen suficiente.'
        ]))
      ]
    });

    html += '<section class="metodo-sec"><div class="metodo-sec__head"><span class="dept-icon" aria-hidden="true"><svg><use href="#i-general"/></svg></span><h3>Reglas comunes y hallazgos</h3></div><div class="method__body"><div>' +
      sub('Reglas comunes', list(COMMON_RULES.concat([
        'Día parcial (*): el primer o último día del archivo cuyo primer/último registro difiere al menos ' + CONFIG.partialDayMarginMin + ' min de los demás días del mismo tipo (lunes a viernes, sábado o domingo).',
        'Los filtros (departamento, campaña, fecha, mes y rango de meses) se combinan y solo cambian la vista.'
      ]))) + '</div><div>' +
      sub('Cómo se generan los hallazgos', list([
        'Se calculan con los datos de la selección actual, por reglas fijas; no contienen cifras estimadas.',
        'Cada vista evalúa una lista ordenada de candidatos (abandono por franja, tolerancia de espera, cortes por ACD timeout, carga por agente, transferencias, abandono del marcador, tipificación, conexión por hora, reintentos sin conexión, comparación de modos, conexión por agente) y muestra los cuatro primeros con sustento.',
        'Una franja, día o agente necesita al menos ' + CONFIG.findingsMinN + ' llamadas; reintentos sin conexión: números con ' + CONFIG.findingsRetryMin + ' o más intentos y ninguna conectada.',
        'Si no hay sustento suficiente, se muestran menos hallazgos y se indica el motivo.',
        'General presenta hallazgos consolidados entre departamentos, distintos de los de cada área.'
      ])) + '</div></div></section>';
    return html;
  }

  // ---------------- arranque ----------------
  function init() {
    bindTabs();
    bindFilters();
    activate(state.activeTab, false);
    loadDefault();
    window.addEventListener('resize', function () { resizeCharts(state.activeTab); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CTApp = { state: state, setDataset: setDataset };
})();
