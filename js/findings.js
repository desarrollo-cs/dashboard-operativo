/* Hallazgos operativos generados por reglas a partir de los datos filtrados.
 * Cada candidato se evalúa en un orden fijo de prioridad y solo se publica si los datos
 * alcanzan el volumen mínimo (CONFIG.findingsMinN). Se muestran los primeros cuatro válidos.
 * Ninguna cifra se estima ni se completa: todas salen de los registros de la selección. */
(function (root) {
  'use strict';
  var CONFIG = root.CTConfig || (typeof require !== 'undefined' ? require('./config.js') : null);
  var MIN = function () { return CONFIG.findingsMinN; };
  var nf0 = new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat(CONFIG.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat(CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function I(v) { return nf0.format(v); }
  function P(v) { return nf1.format(v) + ' %'; }
  function pct(n, d) { return d > 0 ? n / d * 100 : null; }
  function H(h) { return (h < 10 ? '0' : '') + h + ':00'; }
  function D(d) { return d.slice(8, 10) + '/' + d.slice(5, 7); }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = (s.length - 1) / 2;
    return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
  }
  function validWait(r) { return r.we != null && r.we >= 0 && r.we <= CONFIG.maxDurationSec; }
  function f(title, evidence, implication, basis) { return { title: title, evidence: evidence, implication: implication, basis: basis }; }
  function pick(cands, n) {
    var out = [];
    for (var i = 0; i < cands.length && out.length < n; i++) {
      var x = null;
      try { x = cands[i](); } catch (e) { x = null; }
      if (x) out.push(x);
    }
    return out;
  }

  // ---------------- entrantes (SAC, Crédito) ----------------
  function inbound(E, v, label) {
    var ofrList = E.filter(function (r) { return r.q === 1; });
    var cands = [
      function () { // franja con más abandonos
        var rows = v.byHour.filter(function (h) { return h.ofr >= MIN(); });
        if (!rows.length || !v.abandonadas) return null;
        var t = rows.slice().sort(function (a, b) { return b.ab - a.ab || b.pct - a.pct; })[0];
        if (!t.ab) return null;
        return f('La franja de las ' + H(t.hour) + ' concentra el ' + P(pct(t.ab, v.abandonadas)) + ' de los abandonos',
          I(t.ab) + ' abandonadas de ' + I(t.ofr) + ' ofrecidas en esa hora (' + P(t.pct) + ' de abandono) frente a ' + P(v.pctAb) + ' en todo el período.',
          'Es la hora en la que más llamadas se pierden; ajustar la dotación o la programación de pausas en esa franja es la palanca con mayor efecto sobre el abandono total.',
          'Por hora: abandonadas / ofrecidas');
      },
      function () { // tolerancia de espera
        var ab = ofrList.filter(function (r) { return r.ab === 1 && r.f === 'Contacto' && validWait(r); }).map(function (r) { return r.we; });
        var at = ofrList.filter(function (r) { return r.a === 1 && validWait(r); }).map(function (r) { return r.we; });
        if (ab.length < MIN() || !at.length) return null;
        var mAb = median(ab), mAt = median(at);
        return f('La mitad de los clientes que abandonan cuelga en ' + I(mAb) + ' s de espera o menos',
          'Espera mediana de los abandonos del cliente: ' + I(mAb) + ' s (' + I(ab.length) + ' llamadas). Espera mediana de las atendidas: ' + I(mAt) + ' s; P90 de las atendidas: ' + I(v.wait.p90) + ' s.',
          'Atender por debajo de ' + I(mAb) + ' s es el objetivo de espera que más abandonos del cliente puede evitar; a partir de ese punto conviene ofrecer mensaje en cola o devolución de llamada.',
          'Tiempo Esp. de abandonadas con finalizador «Contacto»');
      },
      function () { // ACD timeout
        var sys = ofrList.filter(function (r) { return r.ab === 1 && r.f === 'ACD timeout'; });
        if (sys.length < 5 || !v.abandonadas) return null;
        var w = sys.filter(validWait).map(function (r) { return r.we; });
        var mx = w.length ? Math.max.apply(null, w) : null;
        return f('El ' + P(pct(sys.length, v.abandonadas)) + ' de los abandonos son cortes del sistema por tiempo máximo en cola',
          I(sys.length) + ' llamadas finalizaron por «ACD timeout» (' + P(v.pctAbSis) + ' de las ofrecidas)' +
          (w.length ? '; su espera mediana fue de ' + I(median(w)) + ' s (máximo ' + I(mx) + ' s).' : '.'),
          'No las cuelga el cliente: la plataforma corta la llamada. Revisar en inConcert el tiempo máximo en cola y el desborde hacia otra cola o buzón permite retener parte de ellas.',
          'Finalizador «ACD timeout»');
      },
      function () { // carga por agente
        var ag = v.agents;
        if (ag.length < 2 || v.atendidas < MIN()) return null;
        var top = ag[0];
        var talk = ag.filter(function (a) { return a.talkN >= MIN() && a.talkMean != null; }).sort(function (a, b) { return a.talkMean - b.talkMean; });
        var ev = 'Atendidas: ' + ag.slice(0, 3).map(function (a) { return a.name + ' ' + I(a.aten); }).join(', ') + ' (' + I(ag.length) + ' agentes con atención).';
        if (talk.length >= 2) ev += ' Conversación promedio entre ' + nf2.format(talk[0].talkMean) + ' min (' + talk[0].name + ') y ' + nf2.format(talk[talk.length - 1].talkMean) + ' min (' + talk[talk.length - 1].name + ').';
        return f(top.name + ' atiende el ' + P(pct(top.aten, v.atendidas)) + ' de las llamadas de ' + label,
          ev,
          'La capacidad depende de pocos agentes: una ausencia en ese perfil impacta de forma directa la espera y el abandono.' + (talk.length >= 2 ? ' La diferencia de duración entre agentes señala dónde revisar guion y calibración.' : ''),
          'Último agente de las atendidas');
      },
      function () { // transferencias
        var t = v.transfers;
        if (t.n < 5) return null;
        var notOk = ofrList.filter(function (r) { return r.a === 1 && r.tr === 1 && r.tro === 0; }).length;
        return f('El ' + P(t.pct) + ' de las llamadas atendidas se transfiere',
          I(t.n) + ' transferencias de ' + I(v.atendidas) + ' atendidas; ' + I(notOk) + ' registran «Tr. Ok» = No.',
          'Cada transferencia suma una nueva espera para el cliente; conocer los motivos de transferencia permite resolver más casos en la primera atención.',
          'Tr. y Tr. Ok de atendidas');
      },
      function () { // día con mayor abandono
        var rows = v.byDay.filter(function (d) { return d.ofr >= MIN(); });
        if (rows.length < 2) return null;
        var t = rows.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
        return f('El ' + D(t.day) + ' registró el mayor abandono del período: ' + P(t.pct),
          I(t.ab) + ' abandonadas de ' + I(t.ofr) + ' ofrecidas, frente a ' + P(v.pctAb) + ' del período.',
          'Contrastar ese día con la dotación programada ayuda a identificar si el abandono responde a volumen o a disponibilidad de agentes.',
          'Por fecha: abandonadas / ofrecidas');
      }
    ];
    return pick(cands, 4);
  }

  // ---------------- salientes ----------------
  function phoneStats(S) {
    var ph = {};
    S.forEach(function (r) { if (!r.p) return; var o = ph[r.p] || (ph[r.p] = { n: 0, c: 0 }); o.n++; if (r.a === 1) o.c++; });
    var k = CONFIG.findingsRetryMin, nums = 0, att = 0;
    Object.keys(ph).forEach(function (p) { if (ph[p].n >= k && ph[p].c === 0) { nums++; att += ph[p].n; } });
    return { nums: nums, att: att };
  }

  function outCandidates(S, o) {
    return {
      dialerAbandon: function () {
        var m = o.modes['Marcación'];
        if (m.abMarc < 5) return null;
        return f('El ' + P(o.pctAbMarc) + ' de las llamadas contestadas en el marcador se pierde sin agente',
          I(m.abMarc) + ' clientes contestaron y no fueron conectados con un agente, de ' + I(m.con + m.abMarc) + ' contestadas en modo marcador.',
          'Son contactos ya logrados que se desperdician; ajustar el ritmo de marcación a los agentes disponibles los convierte en conversaciones sin consumir más base.',
          'Ab. = Si en modo Marcación');
      },
      hours: function () {
        var rows = o.byHour.filter(function (h) { return h.intentos >= MIN() && h.pctCon != null; });
        if (rows.length < 2) return null;
        var s = rows.slice().sort(function (a, b) { return b.pctCon - a.pctCon; });
        var best = s[0], worst = s[s.length - 1];
        if (best.pctCon - worst.pctCon < 1) return null;
        return f('La conexión varía de ' + P(worst.pctCon) + ' a ' + P(best.pctCon) + ' según la hora',
          H(best.key) + ': ' + P(best.pctCon) + ' (' + I(best.intentos) + ' intentos) · ' + H(worst.key) + ': ' + P(worst.pctCon) + ' (' + I(worst.intentos) + ' intentos). Período: ' + P(o.base.pctCon) + '.',
          'Concentrar reintentos en las franjas de mayor conexión aumenta los contactos con el mismo número de intentos.',
          'Por hora: conectadas / intentos (franjas con ≥' + MIN() + ' intentos)');
      },
      retries: function () {
        var x = phoneStats(S);
        if (x.nums < 5) return null;
        return f(I(x.nums) + ' números acumulan ' + I(x.att) + ' intentos sin ninguna conexión',
          'Números con ' + CONFIG.findingsRetryMin + ' o más intentos y ninguna llamada conectada: ' + I(x.nums) + ' (' + I(x.att) + ' intentos, ' + P(pct(x.att, o.base.intentos)) + ' del total).',
          'Son intentos que no producen contacto; limitar reintentos o actualizar esos números libera capacidad de marcación para otros clientes.',
          'Dir. normalizado y Aten. por número');
      },
      modes: function () {
        var a = o.modes.Manual, b = o.modes['Marcación'];
        if (a.intentos < MIN() || b.intentos < MIN() || !a.con || !b.con) return null;
        return f('El marcador necesita ' + nf1.format(b.intentos / b.con) + ' intentos por conexión; el modo manual, ' + nf1.format(a.intentos / a.con),
          '% conexión: manual ' + P(a.pctCon) + ' (' + I(a.con) + ' de ' + I(a.intentos) + '); marcador ' + P(b.pctCon) + ' (' + I(b.con) + ' de ' + I(b.intentos) + ').',
          'La diferencia no prueba una causa (las bases de cada modo pueden ser distintas), pero cuantifica el costo en intentos de cada modo para asignar capacidad y revisar las bases del marcador.',
          'Tipo de Llamada saliente');
      },
      agents: function () {
        var rows = o.byAgent.filter(function (a) { return a.intentos >= MIN() && a.pctCon != null; });
        if (rows.length < 3) return null;
        var s = rows.slice().sort(function (a, b) { return b.pctCon - a.pctCon; });
        var best = s[0], worst = s[s.length - 1];
        return f('La conexión por agente va de ' + P(worst.pctCon) + ' a ' + P(best.pctCon),
          best.key + ': ' + P(best.pctCon) + ' (' + I(best.intentos) + ' intentos) · ' + worst.key + ': ' + P(worst.pctCon) + ' (' + I(worst.intentos) + ' intentos). ' + I(rows.length) + ' agentes con ≥' + MIN() + ' intentos.',
          'Si las bases y los modos asignados son comparables, la brecha señala prácticas de marcación o de gestión a revisar; si no lo son, conviene compararlos por campaña.',
          'Primer agente: conectadas / intentos');
      }
    };
  }

  function ventas(S, v) {
    var c = outCandidates(S, v);
    var con = v.base.con;
    var cands = [
      c.dialerAbandon,
      function () {
        var n = v.groups['Sin tipificación'] || 0;
        if (n < 5 || !con) return null;
        return f('El ' + P(pct(n, con)) + ' de las llamadas conectadas no tiene tipificación',
          I(n) + ' de ' + I(con) + ' conectadas con agente no registran «Disp. Abs.».',
          'Sin tipificación no puede medirse el resultado comercial de esas conversaciones ni programar su seguimiento; exigir el cierre de gestión en inConcert mejora la trazabilidad.',
          'Disp. Abs. de conectadas');
      },
      function () {
        var n = v.groups['Baja por riesgo'] || 0;
        if (n < 5 || !con) return null;
        var det = Object.keys(v.groupDetail).filter(function (k) { return v.groupDetail[k].group === 'Baja por riesgo'; })
          .sort(function (a, b) { return v.groupDetail[b].n - v.groupDetail[a].n; }).slice(0, 2)
          .map(function (k) { return '«' + k.replace('/Baja/', '') + '» ' + I(v.groupDetail[k].n); });
        return f('El ' + P(pct(n, con)) + ' de las conectadas termina en baja por riesgo',
          I(n) + ' de ' + I(con) + ' conectadas; principales: ' + det.join(', ') + '.',
          'Son contactos no elegibles por criterios de riesgo; si esa información está disponible antes de marcar, filtrar la base libera tiempo de agentes para prospectos elegibles.',
          'Agrupación de tipificaciones (Metodologías)');
      },
      c.hours, c.retries, c.agents, c.modes
    ];
    return pick(cands, 4);
  }

  function cobros(S, c) {
    var oc = outCandidates(S, c), inb = c.inb;
    var cands = [
      oc.modes, oc.dialerAbandon, oc.retries,
      function () {
        if (inb.ofrecidas < MIN()) return null;
        return f('La línea entrante de Cobros pierde el ' + P(inb.pctAb) + ' de las llamadas ofrecidas',
          I(inb.abandonadas) + ' de ' + I(inb.ofrecidas) + ' ofrecidas abandonadas: ' + I(inb.abSistema) + ' por tiempo máximo en cola («ACD timeout») y ' + I(inb.abCliente) + ' por el cliente.',
          'Son clientes que llaman por iniciativa propia; asegurar cobertura de agentes en la línea entrante evita perder contactos que la operación saliente busca activamente.',
          'Línea entrante de Cobros: Ab. / ofrecidas');
      },
      oc.hours, oc.agents
    ];
    return pick(cands, 4);
  }

  // ---------------- General ----------------
  function general(recs, g) {
    var cands = [
      function () {
        var d = g.perDept.filter(function (x) { return x.ofrecidas >= MIN() && x.pctAb != null; });
        if (d.length < 2) return null;
        var s = d.slice().sort(function (a, b) { return b.pctAb - a.pctAb; }), hi = s[0], lo = s[s.length - 1];
        return f(hi.dept + ' tiene el mayor abandono entrante: ' + P(hi.pctAb),
          hi.dept + ': ' + I(hi.abandonadas) + ' de ' + I(hi.ofrecidas) + ' ofrecidas · ' + lo.dept + ': ' + P(lo.pctAb) + ' (' + I(lo.abandonadas) + ' de ' + I(lo.ofrecidas) + ').',
          'La cola de ' + hi.dept + ' pierde proporcionalmente más clientes; es la cola entrante a priorizar en dotación y configuración.',
          'Por departamento: Ab. / ofrecidas');
      },
      function () {
        var d = g.perDept.filter(function (x) { return x.intentos >= MIN() && x.pctCon != null; });
        if (d.length < 2) return null;
        var s = d.slice().sort(function (a, b) { return b.pctCon - a.pctCon; }), hi = s[0], lo = s[s.length - 1];
        return f('La conexión saliente va de ' + P(lo.pctCon) + ' en ' + lo.dept + ' a ' + P(hi.pctCon) + ' en ' + hi.dept,
          hi.dept + ': ' + I(hi.con) + ' conectadas de ' + I(hi.intentos) + ' intentos · ' + lo.dept + ': ' + I(lo.con) + ' de ' + I(lo.intentos) + '.',
          lo.dept + ' concentra ' + P(pct(lo.intentos, g.salientes)) + ' de los intentos salientes con la menor tasa de conexión; mejorar su contactabilidad es lo que más contactos agrega a la operación.',
          'Por departamento: Aten. / intentos');
      },
      function () {
        var inAg = new Set(recs.filter(function (r) { return r.d === 'E' && r.a === 1 && r.agL; }).map(function (r) { return r.agL; }));
        var both = Array.from(new Set(recs.filter(function (r) { return r.d === 'S' && r.ag1 && inAg.has(r.ag1); }).map(function (r) { return r.ag1; })));
        if (!both.length) return null;
        var hIn = g.hour.slice().sort(function (a, b) { return b.ofrecidas - a.ofrecidas; })[0];
        var hOut = g.hour.slice().sort(function (a, b) { return b.intentos - a.intentos; })[0];
        if (!hIn || !hIn.ofrecidas || !hOut.intentos) return null;
        var same = hIn.hour === hOut.hour;
        return f(I(both.length) + ' agentes combinan atención entrante y llamadas salientes',
          'Pico de entrantes ofrecidas: ' + H(hIn.hour) + ' (' + I(hIn.ofrecidas) + '); pico de intentos salientes: ' + H(hOut.hour) + ' (' + I(hOut.intentos) + ').',
          same ? 'Ambos picos coinciden: las salientes compiten con la cola entrante por los mismos agentes. Mover parte de los intentos fuera de esa hora protege el abandono entrante.'
            : 'Los picos no coinciden; al programar salientes con agentes compartidos conviene mantenerlos fuera de la hora pico entrante para no elevar el abandono.',
          'Agentes en entrantes atendidas y en salientes');
      },
      function () {
        var rows = g.inb.byDay.filter(function (d) { return d.ofr >= MIN(); });
        if (rows.length < 2) return null;
        var t = rows.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
        return f('El ' + D(t.day) + ' fue el día con mayor abandono entrante: ' + P(t.pct),
          I(t.ab) + ' abandonadas de ' + I(t.ofr) + ' ofrecidas en todas las colas, frente a ' + P(g.inb.pctAb) + ' del período.',
          'Contrastar ese día con la dotación programada permite distinguir si el abandono respondió a volumen o a disponibilidad de agentes.',
          'Por fecha: Ab. / ofrecidas');
      },
      function () {
        var d = g.perDept.filter(function (x) { return x.total; }).sort(function (a, b) { return b.total - a.total; })[0];
        if (!d || !g.total) return null;
        return f(d.dept + ' concentra el ' + P(pct(d.total, g.total)) + ' de los registros',
          I(d.total) + ' de ' + I(g.total) + ' registros (' + I(d.E) + ' entrantes, ' + I(d.S) + ' salientes).',
          'Es el área que más capacidad consume; sus indicadores determinan la mayor parte del resultado global.',
          'Registros por departamento');
      }
    ];
    return pick(cands, 4);
  }

  var api = { inbound: inbound, ventas: ventas, cobros: cobros, general: general };
  root.CTFindings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
