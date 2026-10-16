# CANALES-BOT Serverless

Versión independiente de CANALES-BOT adaptada a Telegram Serverless. El repositorio original `Nikki-Resendizx/Canales-bot` no se modifica.

## Estado actual
Base de migración en desarrollo. **No desplegar todavía**: el panel muestra módulos en preparación y aún faltan la gestión completa de canales, blacklist desde el panel, plantillas, publicaciones completas y pagos.

Implementado en el repositorio:
- `/start`, `/help` y panel `/admin` inicial con 3 botones por fila.
- Esquema persistente para administradores, canales, configuración por canal, CAPTCHA, blacklist global, rutas, plantillas, publicaciones, compras y reportes de reacciones.
- Bienvenida configurable por canal mediante variables `{mencion}`, `{nombre}`, `{username}` y `{userid}`.
- CAPTCHA aritmético por canal con botones; respuesta incorrecta o vencimiento aplica baneo permanente en ese grupo.
- Aplicación de blacklist global al entrar a un grupo donde el bot tenga permisos.
- Copia básica de publicaciones entre canales configurados en la base de datos.
- Avisos de cambios de reacción cuando el canal tiene un chat de reporte configurado.
- Validación de sintaxis con GitHub Actions.

## Plataforma
- Telegram Serverless con `@tgcloud/cli` y JavaScript ES modules dentro de `tgcloud/`.
- Usa el SDK oficial (`sdk`); no usa Telegraf, polling, procesos permanentes ni filesystem en tiempo de ejecución.
- La base de datos persiste entre ejecuciones. Los cambios de esquema se aplican por separado con `npx tgcloud migrate`.

## Preparación local (GitHub Codespaces)
1. Usa Node.js 18 o posterior.
2. Ejecuta `npm install`.
3. En @BotFather, activa Serverless para el **bot nuevo** y copia el CLI Access Token (no el token normal del Bot API).
4. Ejecuta `npx tgcloud login`.
5. Ejecuta `npm run validate` y luego prueba con `npx tgcloud run handlers/message '{ chat: { id: 123 }, text: "/start", from: { id: 123, first_name: "Prueba" } }'`.

## Antes de probar o desplegar
- Cambiar `OWNER_ID = 0` en `tgcloud/handlers/message.js` y `tgcloud/handlers/callback_query.js` por el ID numérico real del propietario. Mientras esté en `0`, el panel no tendrá un propietario autorizado por ID.
- Dar al bot los permisos necesarios en cada grupo/canal; sin ellos no puede banear ni copiar publicaciones.
- Revisar y probar todas las funciones pendientes en un bot y canales de prueba.

## Despliegue
Todavía no ejecutar `push` ni `migrate` en producción. Cuando termine la revisión, el flujo será:
```sh
npm run validate
npx tgcloud status
npx tgcloud push
npx tgcloud migrate
npx tgcloud webhook sync
```

No guardar tokens en el repositorio. Los pagos Telegram Stars, reembolsos, edición completa de plantillas, álbumes, botones, blacklist administrable y respaldo/restauración siguen pendientes de implementación y pruebas controladas.
