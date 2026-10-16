import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const schemaPath = 'tgcloud/schema.js';
const originalSchema = readFileSync(schemaPath, 'utf8');
const imports = "import { table, integer, text } from 'sdk/db';\n\n";
const tablePattern = /export const (\w+) = table\('([^']+)', \{[\s\S]*?\n\}\);/g;
const tables = [...originalSchema.matchAll(tablePattern)];

if (tables.length === 0) {
  throw new Error('No se encontraron declaraciones table(...) en tgcloud/schema.js; se cancela sin modificar la base.');
}

console.log('Migración aislada: ' + tables.length + ' tablas detectadas.');
let failures = 0;

try {
  for (const match of tables) {
    const exportName = match[1];
    const tableName = match[2];
    const isolatedSchema = imports + match[0] + '\n';
    writeFileSync(schemaPath, isolatedSchema, 'utf8');
    console.log('\n=== Migrando tabla ' + tableName + ' (' + exportName + ') ===');

    const result = spawnSync('npx', ['tgcloud', 'migrate', '--safe', '--local'], {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error || result.status !== 0) {
      failures += 1;
      console.error('Falló la migración de ' + tableName + '.', result.error?.message || 'exit code ' + result.status);
    }
  }
} finally {
  writeFileSync(schemaPath, originalSchema, 'utf8');
  console.log('Se restauró tgcloud/schema.js original.');
}

if (failures > 0) {
  console.error('Migración incompleta: ' + failures + ' de ' + tables.length + ' tablas fallaron.');
  process.exitCode = 1;
} else {
  console.log('Migración terminada: ' + tables.length + ' tablas procesadas sin errores.');
}
