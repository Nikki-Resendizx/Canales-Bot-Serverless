import { readFile } from 'node:fs/promises';

const path = new URL('../config/constructor.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
const supportedModules = new Set([
  'Publicaciones',
  'Plantillas',
  'Hashtags',
  'Botones',
]);
const errors = [];

if (config.schemaVersion !== 1) errors.push('schemaVersion debe ser 1.');
if (config.name !== 'CANALES-BOT-SERVERLESS') errors.push('name no coincide con este proyecto.');
if (config.username !== 'ChannelPosts_RoBot') errors.push('username no coincide con el bot configurado.');
if (config.template !== 'channel') errors.push('template debe ser channel.');
if (!Array.isArray(config.modules) || config.modules.length === 0) {
  errors.push('modules debe ser una lista no vacía.');
} else {
  const seen = new Set();
  for (const moduleName of config.modules) {
    if (typeof moduleName !== 'string' || !supportedModules.has(moduleName)) {
      errors.push(`Módulo no soportado: ${String(moduleName)}`);
    } else if (seen.has(moduleName)) {
      errors.push(`Módulo duplicado: ${moduleName}`);
    }
    seen.add(moduleName);
  }
}

if (errors.length) {
  console.error('Configuración exportada del Constructor no válida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Configuración válida: ${config.name} (${config.username})`);
  console.log(`Módulos solicitados: ${config.modules.join(', ')}`);
  console.log('La configuración se valida como manifiesto; no desactiva funciones existentes ni contiene credenciales.');
}
