#!/usr/bin/env node
/* Regenera data/dataset.json (anonimizado) a partir del Excel exportado de inConcert.
 * Uso: node scripts/build-dataset.mjs "ruta/al/archivo.xlsx" [salida.json]
 * Usa exactamente el mismo parser que el navegador (js/parser.js). */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = require(resolve(root, 'vendor/xlsx.full.min.js'));
require(resolve(root, 'js/config.js'));
const parser = require(resolve(root, 'js/parser.js'));

const input = process.argv[2];
const output = process.argv[3] || resolve(root, 'data/dataset.json');
if (!input) {
  console.error('Uso: node scripts/build-dataset.mjs <archivo.xlsx> [salida.json]');
  process.exit(1);
}

const buf = readFileSync(input);
const ds = parser.parseWorkbook(XLSX, new Uint8Array(buf), basename(input));
const salt = randomBytes(32); // sal aleatoria que no se guarda: los hashes no son reversibles
const hash = async (p) => createHash('sha256').update(salt).update(String(p)).digest('hex').slice(0, 16);
const compact = await parser.toCompact(ds, hash);
writeFileSync(output, JSON.stringify(compact));
console.log(`Dataset generado: ${output}`);
console.log(`  Hoja de detalle: ${ds.meta.detailSheet} | Tabla de campañas: ${ds.meta.mappingSheet}`);
console.log(`  Registros: ${ds.records.length} | Campañas mapeadas: ${ds.mapping.length}`);
if (ds.meta.issues.length) console.log('  Avisos:\n   - ' + ds.meta.issues.join('\n   - '));
