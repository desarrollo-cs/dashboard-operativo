/* Constructores de opciones ECharts. Cada función recibe datos ya calculados por metrics.js. */
(function (root) {
  'use strict';
  var CONFIG = root.CTConfig;
  var C = CONFIG.colors;
  var FONT = 'Helvetica, Arial, sans-serif';
  var nf0 = new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat(CONFIG.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat(CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  var F = {
    int: function (v) { return v == null ? '—' : nf0.format(v); },
    pct: function (v) { return v == null ? '—' : nf1.format(v) + ' %'; },
    min: function (v) { return v == null ? '—' : nf2.format(v) + ' min'; },
    sec: function (v) { return v == null ? '—' : nf1.format(v) + ' s'; }
  };

  var partialDays = {};
  function setPartialDays(p) { partialDays = p || {}; }
  function dayLabel(d) {
    if (!d) return '';
    return d.slice(8, 10) + '/' + d.slice(5, 7) + (partialDays[d] ? '*' : '');
  }
  function hourLabel(h) { return (h < 10 ? '0' : '') + h + ':00'; }

  function base(extra) {
    var o = {
      textStyle: { fontFamily: FONT, color: C.navy, fontSize: 13 },
      animationDuration: 377,
      grid: { left: 8, right: 13, top: 55, bottom: 55, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        backgroundColor: '#FFFFFF', borderColor: C.grid, textStyle: { color: C.navy, fontFamily: FONT, fontSize: 13 },
        valueFormatter: function (v) { return typeof v === 'number' ? nf0.format(v) : (v == null ? '—' : v); }
      },
      legend: { bottom: 0, itemGap: 13, itemWidth: 13, itemHeight: 8, textStyle: { color: C.navy, fontSize: 13 }, icon: 'roundRect' },
      toolbox: {
        right: 0, top: 0, itemSize: 13, iconStyle: { borderColor: '#919191' },
        emphasis: { iconStyle: { borderColor: C.navy } },
        feature: {
          dataView: { title: 'Ver y editar datos', lang: ['Datos del gráfico', 'Cerrar', 'Aplicar cambios'], readOnly: false,
            buttonColor: C.navy, textareaBorderColor: C.grid },
          saveAsImage: { title: 'Descargar PNG', pixelRatio: 2 }
        }
      }
    };
    return Object.assign(o, extra || {});
  }

  function catAxis(data, rotate, wrapWidth) {
    var lab = { color: C.navy, fontSize: 12, rotate: rotate || 0, hideOverlap: true };
    if (wrapWidth) { lab.width = wrapWidth; lab.overflow = 'breakAll'; lab.interval = 0; lab.hideOverlap = false; lab.lineHeight = 14; }
    return { type: 'category', data: data, axisLine: { lineStyle: { color: '#BCBCBC' } }, axisTick: { show: false }, axisLabel: lab };
  }
  function valAxis(name, opts) {
    return Object.assign({ type: 'value', name: name, nameTextStyle: { color: '#5C5C5C', fontSize: 12, align: 'left' },
      splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.navy, fontSize: 12, formatter: function (v) { return nf0.format(v); } }, minInterval: 1 }, opts || {});
  }
  function pctAxis(name) {
    return valAxis(name || '%', { min: 0, max: 100, splitLine: { show: false }, minInterval: 0,
      axisLabel: { color: C.navy, fontSize: 12, formatter: '{value} %' } });
  }
  function bar(name, data, color, stack, extra) {
    return Object.assign({ name: name, type: 'bar', stack: stack, data: data, itemStyle: { color: color }, barMaxWidth: 34,
      emphasis: { focus: 'series' } }, extra || {});
  }
  function pctLine(name, data, color, yIndex, dashed) {
    return { name: name, type: 'line', yAxisIndex: yIndex == null ? 1 : yIndex, data: data, smooth: false, connectNulls: false,
      symbol: 'circle', symbolSize: 5, itemStyle: { color: color }, lineStyle: { color: color, width: 2.5, type: dashed ? 'dashed' : 'solid' },
      tooltip: { valueFormatter: F.pct } };
  }

  function empty(message) {
    return {
      graphic: { type: 'text', left: 'center', top: 'middle',
        style: { text: message || 'Sin datos para los filtros seleccionados', fill: '#5C5C5C', fontSize: 13, fontFamily: FONT } },
      xAxis: { show: false }, yAxis: { show: false }, series: []
    };
  }

  // Embudo: ancho proporcional al valor respecto de la primera etapa
  function funnel(stages, opts) {
    opts = opts || {};
    if (!stages.length || !stages[0].value) return empty(opts.emptyMessage);
    var top = stages[0].value;
    var shades = [C.navy, '#304C9B', '#356D9F', '#505E92', '#8F97BB'];
    return base({
      tooltip: { trigger: 'item', confine: true, backgroundColor: '#FFFFFF', borderColor: C.grid,
        textStyle: { color: C.navy, fontFamily: FONT, fontSize: 13 },
        formatter: function (p) {
          var i = p.dataIndex, s = stages[i];
          var prev = i > 0 ? stages[i - 1].value : null;
          return '<b>' + s.name + '</b><br>' + F.int(s.value) + ' llamadas<br>' +
            F.pct(s.value / top * 100) + ' de ' + stages[0].name.toLowerCase() +
            (prev != null ? '<br>' + F.pct(prev ? s.value / prev * 100 : null) + ' de la etapa anterior' : '');
        } },
      legend: { show: false },
      series: [{
        type: 'funnel', left: '2%', top: 21, bottom: 8, width: '52%', min: 0, max: top, minSize: '2%', maxSize: '100%',
        sort: 'none', gap: 3, funnelAlign: 'left',
        label: { show: true, position: 'right', color: C.navy, fontSize: 12, lineHeight: 16,
          formatter: function (p) { return '{n|' + p.name + '}\n{v|' + F.int(p.value) + '}  ' + F.pct(p.value / top * 100); },
          rich: { n: { color: '#303031', fontSize: 12 }, v: { color: C.navy, fontWeight: 'bold', fontSize: 13 } } },
        labelLine: { show: false },
        itemStyle: { borderWidth: 0 },
        data: stages.map(function (s, i) { return { name: s.name, value: s.value, itemStyle: { color: shades[Math.min(i, shades.length - 1)] } }; })
      }]
    });
  }

  // Barras apiladas atendidas/abandonadas + línea de % abandono (entrantes)
  function inboundSeries(rows, labels, opts) {
    opts = opts || {};
    if (!rows.some(function (r) { return r.ofr; })) return empty();
    var series = [
      bar('Atendidas', rows.map(function (r) { return r.aten; }), C.sky, 'v'),
      bar('Abandonadas', rows.map(function (r) { return r.ab; }), C.orange, 'v'),
      pctLine('% abandono', rows.map(function (r) { return r.pct == null ? null : +r.pct.toFixed(1); }), C.navy)
    ];
    if (opts.reference) series.push(pctLine(opts.referenceName, opts.reference.map(function (v) { return v == null ? null : +v.toFixed(1); }), '#8F97BB', 1, true));
    return base({
      xAxis: catAxis(labels, opts.rotate),
      yAxis: [valAxis('Llamadas'), pctAxis()],
      series: series
    });
  }

  function heatmap(heat, hours) {
    var data = [], low = [], maxPct = 0, any = false;
    heat.forEach(function (row, w) {
      row.forEach(function (cell, i) {
        if (cell.ofr > 0) any = true;
        if (cell.ofr >= CONFIG.heatmapMinCalls) {
          data.push({ value: [i, w, +cell.pct.toFixed(1)], ofr: cell.ofr, ab: cell.ab });
          if (cell.pct > maxPct) maxPct = cell.pct;
        } else {
          low.push({ value: [i, w, 0], ofr: cell.ofr, ab: cell.ab });
        }
      });
    });
    if (!any) return empty();
    return base({
      grid: { left: 8, right: 13, top: 34, bottom: 55, containLabel: true },
      tooltip: { trigger: 'item', confine: true, backgroundColor: '#FFFFFF', borderColor: C.grid,
        textStyle: { color: C.navy, fontFamily: FONT, fontSize: 13 },
        formatter: function (p) {
          var d = p.data;
          var head = CONFIG.weekdays[d.value[1]] + ' ' + hourLabel(hours[d.value[0]]);
          if (d.ofr < CONFIG.heatmapMinCalls) return '<b>' + head + '</b><br>' + F.int(d.ofr) + ' ofrecidas (menos de ' + CONFIG.heatmapMinCalls + '; % no mostrado)';
          return '<b>' + head + '</b><br>% abandono: ' + F.pct(d.value[2]) + '<br>' + F.int(d.ab) + ' abandonadas de ' + F.int(d.ofr) + ' ofrecidas';
        } },
      legend: { show: false },
      xAxis: Object.assign(catAxis(hours.map(hourLabel)), { splitArea: { show: false } }),
      yAxis: { type: 'category', data: CONFIG.weekdays, inverse: true, axisTick: { show: false },
        axisLine: { show: false }, axisLabel: { color: C.navy, fontSize: 12 } },
      visualMap: { min: 0, max: Math.max(1, Math.ceil(maxPct)), calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
        itemWidth: 8, itemHeight: 89, text: ['% abandono', '0 %'], textStyle: { color: C.navy, fontSize: 12 },
        inRange: { color: ['#FFFFFF', C.orange] }, seriesIndex: 0 },
      series: [
        { type: 'heatmap', data: data, itemStyle: { borderColor: C.grid, borderWidth: 1 },
          label: { show: true, fontSize: 10, color: C.navy, formatter: function (p) { return Math.round(p.value[2]); } } },
        { type: 'scatter', data: low, symbolSize: 0, silent: false,
          label: { show: true, formatter: '—', color: '#919191', fontSize: 11, position: 'inside' } }
      ]
    });
  }

  function waitBuckets(b) {
    if (!sumArr(b.aten) && !sumArr(b.ab)) return empty();
    return base({
      xAxis: catAxis(CONFIG.waitBuckets.map(function (x) { return x.label; })),
      yAxis: [valAxis('Llamadas')],
      series: [bar('Atendidas', b.aten, C.sky), bar('Abandonadas', b.ab, C.orange)]
    });
  }

  function agentsInbound(agents) {
    if (!agents.length) return empty();
    var names = agents.map(function (a) { return a.name; });
    return base({
      xAxis: catAxis(names, names.length > 6 ? 35 : 0),
      yAxis: [valAxis('Atendidas'), valAxis('Minutos', { splitLine: { show: false }, minInterval: 0, axisLabel: { color: C.navy, fontSize: 12, formatter: function (v) { return nf1.format(v); } } })],
      series: [
        bar('Atendidas', agents.map(function (a) { return a.aten; }), C.sky),
        { name: 'Conversación prom. (min)', type: 'line', yAxisIndex: 1, data: agents.map(function (a) { return a.talkMean == null ? null : +a.talkMean.toFixed(2); }),
          symbol: 'circle', symbolSize: 6, itemStyle: { color: C.green }, lineStyle: { color: C.green, width: 2.5 },
          tooltip: { valueFormatter: F.min } }
      ]
    });
  }

  // Salientes por categoría (fecha, hora, campaña): conectadas / abandonos / no conectadas + % conexión
  function outboundStatus(rows, labels, opts) {
    opts = opts || {};
    if (!rows.some(function (r) { return r.intentos; })) return empty();
    var series = [
      bar('Conectadas', rows.map(function (r) { return r.con; }), C.sky, 's'),
      bar('Abandono marcador', rows.map(function (r) { return r.abMarc; }), C.orange, 's')
    ];
    if (rows.some(function (r) { return r.abOtro; })) {
      series.push(bar('Abandono manual', rows.map(function (r) { return r.abOtro; }), '#F2C98D', 's'));
    }
    series.push(bar('No conectadas', rows.map(function (r) { return r.noCon; }), C.notConnected, 's'));
    if (rows.some(function (r) { return r.sinEstado; })) series.push(bar('Sin estado', rows.map(function (r) { return r.sinEstado; }), '#5C5C5C', 's'));
    if (opts.withPct !== false) series.push(pctLine('% conexión', rows.map(function (r) { return r.pctCon == null ? null : +r.pctCon.toFixed(1); }), C.green));
    return base({
      xAxis: catAxis(labels, opts.rotate, opts.wrap),
      yAxis: opts.withPct === false ? [valAxis('Intentos')] : [valAxis('Intentos'), pctAxis()],
      series: series
    });
  }

  function outboundAgents(rows, opts) {
    opts = opts || {};
    if (!rows.length) return empty();
    var names = rows.map(function (r) { return r.key; });
    var series = [
      bar('Conectadas', rows.map(function (r) { return r.con; }), C.sky, 's'),
      bar('Abandono marcador', rows.map(function (r) { return r.abMarc; }), C.orange, 's')
    ];
    if (rows.some(function (r) { return r.abOtro; })) series.push(bar('Abandono manual', rows.map(function (r) { return r.abOtro; }), '#F2C98D', 's'));
    series.push(bar('No conectadas', rows.map(function (r) { return r.noCon; }), C.notConnected, 's'));
    series.push({ name: 'Conversación prom. (min)', type: 'line', yAxisIndex: 1,
      data: rows.map(function (r) { return r.talkMean == null ? null : +r.talkMean.toFixed(2); }),
      symbol: 'circle', symbolSize: 6, itemStyle: { color: C.green }, lineStyle: { color: C.green, width: 2.5 }, tooltip: { valueFormatter: F.min } });
    return base({
      xAxis: catAxis(names, names.length > 5 ? 35 : 0),
      yAxis: [valAxis('Intentos'), valAxis('Minutos', { splitLine: { show: false }, minInterval: 0, axisLabel: { color: C.navy, fontSize: 12, formatter: function (v) { return nf1.format(v); } } })],
      series: series
    });
  }

  function salesGroups(groups) {
    var names = CONFIG.salesGroups.order.filter(function (g) { return g in groups; });
    var total = names.reduce(function (s, g) { return s + groups[g]; }, 0);
    if (!total) return empty();
    var colors = { 'Baja por riesgo': '#244092', 'Baja por desinterés': '#356D9F', 'Sin contacto efectivo': '#8F97BB',
      'Seguimiento': '#5EBEB2', 'Otras tipificaciones (sin agrupar)': '#BCBCBC', 'Sin tipificación': '#E6E8F0' };
    return base({
      grid: { left: 8, right: 55, top: 34, bottom: 21, containLabel: true },
      tooltip: { trigger: 'item', confine: true, backgroundColor: '#FFFFFF', borderColor: C.grid, textStyle: { color: C.navy, fontFamily: FONT, fontSize: 13 },
        formatter: function (p) { return '<b>' + p.name + '</b><br>' + F.int(p.value) + ' conectadas<br>' + F.pct(p.value / total * 100) + ' de las conectadas'; } },
      legend: { show: false },
      xAxis: valAxis('Conectadas'),
      yAxis: { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: '#BCBCBC' } },
        axisLabel: { color: C.navy, fontSize: 12, width: 144, overflow: 'break' } },
      series: [{ type: 'bar', barMaxWidth: 21, data: names.map(function (n) { return { value: groups[n], itemStyle: { color: colors[n] } }; }),
        label: { show: true, position: 'right', color: C.navy, fontSize: 12,
          formatter: function (p) { return F.int(p.value) + ' · ' + F.pct(p.value / total * 100); } } }]
    });
  }

  // Intentos por modo (apilado) + % conexión (total o por modo)
  var MODE_COLORS = { Manual: '#304C9B', 'Marcación': '#8F97BB' };
  function modeSeries(rows, labels, perModePct, rotate) {
    if (!rows.some(function (r) { return r.intentos; })) return empty();
    var series = [
      bar('Manual', rows.map(function (r) { return r.byMode.Manual.intentos; }), MODE_COLORS.Manual, 'm'),
      bar('Marcador', rows.map(function (r) { return r.byMode['Marcación'].intentos; }), MODE_COLORS['Marcación'], 'm')
    ];
    function p(v) { return v == null ? null : +v.toFixed(1); }
    if (perModePct) {
      series.push(pctLine('% conexión manual', rows.map(function (r) { return p(r.byMode.Manual.pctCon); }), C.green));
      series.push(pctLine('% conexión marcador', rows.map(function (r) { return p(r.byMode['Marcación'].pctCon); }), C.green, 1, true));
    } else {
      series.push(pctLine('% conexión', rows.map(function (r) { return p(r.pctCon); }), C.green));
    }
    return base({ xAxis: catAxis(labels, rotate), yAxis: [valAxis('Intentos'), pctAxis()], series: series });
  }

  function agentsByMode(rows) {
    if (!rows.length) return empty();
    var names = rows.map(function (r) { return r.key; });
    return base({
      grid: { left: 8, right: 34, top: 34, bottom: 55, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: '#FFFFFF', borderColor: C.grid,
        textStyle: { color: C.navy, fontFamily: FONT, fontSize: 13 } },
      xAxis: valAxis('Intentos'),
      yAxis: { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: '#BCBCBC' } },
        axisLabel: { color: C.navy, fontSize: 11, interval: 0 } },
      series: [
        bar('Manual', rows.map(function (r) { return r.byMode.Manual.intentos; }), MODE_COLORS.Manual, 'a', { barMaxWidth: 13 }),
        bar('Marcador', rows.map(function (r) { return r.byMode['Marcación'].intentos; }), MODE_COLORS['Marcación'], 'a', { barMaxWidth: 13 })
      ]
    });
  }

  function deptVolume(perDept) {
    if (!perDept.some(function (d) { return d.total; })) return empty();
    var names = perDept.map(function (d) { return d.dept; });
    return base({
      xAxis: catAxis(names),
      yAxis: [valAxis('Registros')],
      series: [
        bar('Entrantes', perDept.map(function (d) { return d.E; }), '#304C9B', 'd'),
        bar('Salientes', perDept.map(function (d) { return d.S; }), '#5EBEB2', 'd',
          { label: { show: true, position: 'top', color: C.navy, fontSize: 12,
            formatter: function (p) { return F.int(perDept[p.dataIndex].total); } } })
      ]
    });
  }

  var DEPT_COLORS = { SAC: '#244092', Ventas: '#5EBEB2', Cobros: '#356D9F', 'Crédito': '#8F97BB', 'Sin clasificar': '#BCBCBC' };
  function deptByDay(rows, depts, labels) {
    if (!rows.length) return empty();
    return base({
      xAxis: catAxis(labels),
      yAxis: [valAxis('Registros')],
      series: depts.map(function (d) { return bar(d, rows.map(function (r) { return r[d] || 0; }), DEPT_COLORS[d] || '#919191', 't'); })
    });
  }

  function hourVolume(rows) {
    if (!rows.some(function (r) { return r.ofrecidas || r.intentos; })) return empty();
    return base({
      xAxis: catAxis(rows.map(function (r) { return hourLabel(r.hour); })),
      yAxis: [valAxis('Llamadas')],
      series: [bar('Entrantes ofrecidas', rows.map(function (r) { return r.ofrecidas; }), '#304C9B'),
        bar('Intentos salientes', rows.map(function (r) { return r.intentos; }), '#5EBEB2')]
    });
  }

  function deptRates(perDept) {
    var rows = perDept.filter(function (d) { return d.ofrecidas || d.intentos; });
    if (!rows.length) return empty();
    function p(v) { return v == null ? null : +v.toFixed(1); }
    return base({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: '#FFFFFF', borderColor: C.grid,
        textStyle: { color: C.navy, fontFamily: FONT, fontSize: 13 }, valueFormatter: F.pct },
      xAxis: catAxis(rows.map(function (d) { return d.dept; })),
      yAxis: [pctAxis('%')],
      series: [
        bar('% abandono entrante', rows.map(function (d) { return p(d.pctAb); }), C.orange, null,
          { label: { show: true, position: 'top', fontSize: 11, color: C.navy, formatter: function (x) { return x.value == null ? '' : nf1.format(x.value); } } }),
        bar('% conexión saliente', rows.map(function (d) { return p(d.pctCon); }), C.sky, null,
          { label: { show: true, position: 'top', fontSize: 11, color: C.navy, formatter: function (x) { return x.value == null ? '' : nf1.format(x.value); } } })
      ]
    });
  }

  function sumArr(a) { return a.reduce(function (s, x) { return s + x; }, 0); }

  root.CTCharts = {
    F: F, setPartialDays: setPartialDays, dayLabel: dayLabel, hourLabel: hourLabel, empty: empty,
    funnel: funnel, inboundSeries: inboundSeries, heatmap: heatmap, waitBuckets: waitBuckets, agentsInbound: agentsInbound,
    outboundStatus: outboundStatus, outboundAgents: outboundAgents, salesGroups: salesGroups, modeSeries: modeSeries,
    agentsByMode: agentsByMode, deptVolume: deptVolume, deptByDay: deptByDay, hourVolume: hourVolume, deptRates: deptRates
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
