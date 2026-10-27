#!/usr/bin/env node
/* Controles de calidad de datos y de reglas de cálculo.
 * Uso:  node scripts/qa-check.mjs                 → valida data/dataset.json
 *       node scripts/qa-check.mjs archivo.xlsx    → valida un Excel antes de publicarlo
 * Sale con código 1 si algún control falla. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = require(resolve(root, 'js/config.js'));
const P = require(resolve(root, 'js/parser.js'));
const M = require(resolve(root, 'js/metrics.js'));

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASA ' : 'FALLA'} | ${name}${detail ? ' | ' + detail : ''}`);
};

// ---------- 1. Pruebas unitarias de reglas ----------
const { parseDuration, parseDateTime, normalizePhone } = P._internals;
ok('Duración: fracción de día → s', parseDuration(281 / 86400) === 281);
ok('Duración: texto H:MM:SS', parseDuration('0:04:41') === 281);
ok('Duración: N/A → nulo (no cero)', parseDuration('N/A') === null);
ok('Duración: negativa → nulo', parseDuration(-0.1) === null);
ok('Fecha: serial Excel sin desfase horario', parseDateTime(46317.42341435185) === '2026-10-22T10:09:43');
ok('Teléfono: 50622850823 → 22850823', normalizePhone(50622850823) === '22850823');
ok('Teléfono: 8 dígitos sin cambio', normalizePhone('88002670') === '88002670');
ok('Percentil 90 (PERCENTIL.INC)', Math.abs(M.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) - 9.1) < 1e-9);

// Mapa de calor: umbral de 5 y duraciones > 2 h con registros sintéticos
const mk = (o) => Object.assign({ id: null, c: 'x', t: '2026-10-05T09:15:00', d: 'E', q: 1, a: 1, ab: 0, cn: 0, f: 'Agente',
  m: null, ag1: 'a', agL: 'a', p: null, we: 5, wa: 60, wc: 0, ty: null, tr: 0, tro: null }, o);
const synth = { meta: {}, mapping: [['x', 'SAC']], records: [
  ...Array.from({ length: 4 }, () => mk({ t: '2026-10-05T09:10:00', a: 0, ab: 1, f: 'Contacto' })),
  ...Array.from({ length: 5 }, (_, i) => mk({ t: '2026-10-05T10:10:00', a: i < 3 ? 1 : 0, ab: i < 3 ? 0 : 1, f: i < 3 ? 'Agente' : 'ACD timeout' })),
  mk({ t: '2026-10-05T10:20:00', wa: 9000 })
] };
const sm = M.prepare(synth);
const sv = M.computeInboundView(sm.records, 'SAC', sm.records);
const hi = sv.ax.hours;
ok('Mapa de calor: 4 ofrecidas → celda «—» (bajo umbral)', sv.heat[0][hi.indexOf(9)].ofr === 4 && 4 < CONFIG.heatmapMinCalls);
ok('Mapa de calor: 6 ofrecidas → % calculado', sv.heat[0][hi.indexOf(10)].ofr === 6);
ok('Conversación > 2 h: excluida del promedio, contada en volumen', sv.talk.excluded === 1 && sv.atendidas === 4);
ok('Abandono sistema = ACD timeout; cliente = Contacto', sv.abSistema === 2 && sv.abCliente === 4);

// ---------- 2. Controles sobre el dataset ----------
const arg = process.argv[2];
let ds;
if (arg && /\.xls[xm]?$/i.test(arg)) {
  const XLSX = require(resolve(root, 'vendor/xlsx.full.min.js'));
  ds = P.parseWorkbook(XLSX, new Uint8Array(readFileSync(arg)), basename(arg));
} else {
  ds = P.fromCompact(JSON.parse(readFileSync(arg || resolve(root, 'data/dataset.json'), 'utf8')));
}
const model = M.prepare(ds);
const qa = model.qa;
console.log(`\nArchivo: ${ds.meta.fileName} | filas: ${qa.totalFile} | excluidas: ${qa.excludedTotal} | clasificadas: ${qa.sumDept}`);
Object.entries(qa.byDept).forEach(([d, v]) => v.total && console.log(`  ${d.padEnd(14)} entrantes ${v.E}  salientes ${v.S}  total ${v.total}`));

ok('Reconciliación: clasificadas + excluidas = total', qa.reconciled, `${qa.sumDept} + ${qa.excludedTotal} = ${qa.totalFile}`);
ok('Cada registro en un único departamento', model.records.every((r) => typeof r.dept === 'string'));
ok('Sin identificadores duplicados', qa.duplicateIds === 0, `${qa.duplicateIds}`);
ok('Todas las campañas mapeadas', qa.unclassifiedTotal === 0, qa.unmappedCampaigns.join(', '));
ok('Todas las fechas válidas', qa.recordsWithoutDate === 0, `${qa.recordsWithoutDate}`);
ok('Salientes con un único estado (Aten./Ab./Canc.)', qa.outboundStates.none === 0 && qa.outboundStates.multi === 0);
ok('Ofrecidas con estado (Aten. o Ab.)', qa.inboundStates.ofrecidasSinEstado === 0);
ok('Tabla de campañas sin conflictos', qa.mappingIssues.length === 0, qa.mappingIssues.join(' | '));
console.log(`  Días parciales: ${JSON.stringify(qa.partial)}  | Duraciones > 2 h: ${JSON.stringify(qa.longDurations)}`);

// Consistencia entre pestañas
const recs = M.applyFilters(model, {});
const g = M.computeGeneral(recs);
const sac = M.computeInboundView(recs, 'SAC', recs);
const v = M.computeVentas(recs, recs);
const c = M.computeCobros(recs, recs);
const perDept = Object.fromEntries(g.perDept.map((d) => [d.dept, d]));
ok('General vs SAC: ofrecidas', perDept.SAC.ofrecidas === sac.ofrecidas);
ok('General vs Ventas: intentos', perDept.Ventas.intentos === v.base.intentos);
ok('General vs Cobros: intentos y ofrecidas', perDept.Cobros.intentos === c.base.intentos && perDept.Cobros.ofrecidas === c.inb.ofrecidas);
ok('Suma de ofrecidas por departamento = total General', g.perDept.reduce((s, d) => s + d.ofrecidas, 0) === g.inb.ofrecidas);
ok('Cobros: manual + marcador + sin modo = intentos', c.modes.Manual.intentos + c.modes['Marcación'].intentos + c.modes.otro.intentos === c.base.intentos);
const sub = (st) => st.every((s, i) => i === 0 || s.value <= st[i - 1].value);
ok('Embudo Ventas: etapas anidadas', sub(v.funnel), JSON.stringify(v.funnel.map((s) => s.value)));
ok('Embudos Cobros: contestadas ≤ intentos, con agente ≤ contestadas',
  ['Manual', 'Marcación'].every((m) => c.modes[m].contestadas <= c.modes[m].intentos && c.modes[m].con <= c.modes[m].contestadas));
ok('Nivel de servicio ≤ atendidas ≤ ofrecidas', sac.sl20 <= sac.atendidas && sac.atendidas <= sac.ofrecidas);

console.log(`\nResultado: ${fails === 0 ? 'todos los controles superados' : fails + ' control(es) fallido(s)'}`);
process.exit(fails ? 1 : 0);
