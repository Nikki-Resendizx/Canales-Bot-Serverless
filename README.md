# CANALES-BOT Serverless

Versión independiente de CANALES-BOT adaptada a Telegram Serverless. El repositorio original `Nikki-Resendizx/Canales-bot` no se modifica.

## Estado
Base inicial del proyecto. No desplegar todavía hasta completar los módulos y las pruebas de equivalencia.

## Plataforma
- Telegram Serverless con `@tgcloud/cli`.
- JavaScript ES modules dentro de `tgcloud/`.
- SDK de plataforma (`sdk`), sin Telegraf, procesos permanentes ni acceso al sistema de archivos en tiempo de ejecución.
- Base de datos persistente de Serverless; cambios de esquema requieren `npx tgcloud migrate`.

## Funciones que se migrarán
- Panel `/admin`, roles de propietario y administradores.
- Registro de canales y permisos por administrador.
- Plantillas por canal, hashtags, sintaxis de botones y formatos.
- Procesamiento de publicaciones: texto, enlaces, fotos, vídeos, álbumes y reenviados.
- Publicaciones gratuitas y pagos Telegram Stars, reembolsos y reintentos de entrega.
- Distribución multicanal con protección contra bucles y duplicados.
- Bienvenida y CAPTCHA configurables por canal, blacklist y baneos globales.
- Avisos de reacciones y reportes operativos.
- Copia/restauración de configuración.

## Preparación local (GitHub Codespaces)
1. Usa Node.js 18 o posterior.
2. Ejecuta `npm install`.
3. En @BotFather, activa Serverless para el bot NUEVO y copia el CLI Access Token (no el token normal del Bot API).
4. Ejecuta `npx tgcloud login`.
5. Ejecuta `npx tgcloud status` y `npx tgcloud run handlers/message '{ chat: { id: 123 }, text: "/start", from: { id: 123, first_name: "Prueba" } }'`.

## Despliegue
No ejecutar `push` hasta revisar todos los módulos:
```sh
npm run validate
npx tgcloud push
npx tgcloud migrate
npx tgcloud webhook sync
```

## Importante
El runtime de Serverless no permite importar paquetes npm dentro de los módulos desplegados ni usar Telegraf, polling, filesystem o procesos persistentes. Los manejadores deben usar el SDK oficial. No guardar tokens en el repositorio. Los pagos, permisos, CAPTCHA, álbumes y distribución requieren pruebas reales controladas antes de producción.
