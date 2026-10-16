# CANALES-BOT Serverless

Migración independiente de CANALES-BOT para **ChannelPosts_RoBot**. El repositorio original `Nikki-Resendizx/Canales-bot` no se modifica.

## Estado de la migración

La base Serverless y el panel administrativo ampliado están desplegados desde GitHub Actions. La validación de sintaxis y la sincronización de webhook se han ejecutado correctamente en las últimas ejecuciones revisadas.

### Funciones implementadas en el código

- `/start`, `/help` y panel privado `/admin` con tres botones por fila.
- Gestión de canales: registrar por ID y detectar el ID de un canal reenviando una publicación de ese canal; listar y quitar canales.
- Bienvenida editable por canal con variables `{mencion}`, `{nombre}`, `{username}` y `{userid}`.
- CAPTCHA aritmético por canal. Una respuesta incorrecta bloquea permanentemente al usuario en ese grupo; el vencimiento se comprueba cuando llega una respuesta, no mediante un temporizador de fondo.
- Blacklist global con resolución de `@username` cuando el bot ya ha observado a ese usuario, intento de baneo en todos los chats conectados y desbaneo global al retirarlo.
- Rutas de publicación entre varios canales origen y un destino; se conserva el reenvío cuando Telegram entrega metadatos de mensaje reenviado.
- Plantillas por canal: crear/editar, listar, borrar, formatos HTML/Markdown/MarkdownV2/OFF y botones inline en JSON.
- Publicaciones de texto y copia de un mensaje al canal mediante `/publish`.
- Flujo inicial de publicaciones de pago con Telegram Stars: `/publish_paid`, factura XTR, validación pre-checkout y entrega de texto o copia del mensaje tras el pago confirmado.
- Reportes de cambios de reacciones identificadas y reportes separados de conteos agregados. Los conteos agregados nunca se presentan como si identificaran usuarios.
- Estadísticas de canales, rutas, plantillas, blacklist, publicaciones, compras y reacciones.
- Registro de usuarios observados para resolver usernames sin inventar IDs.

## Comandos principales

- `/addchannel ID [título]`
- Para detectar un canal: reenvía al bot una publicación del canal y responde a ella con `/addchannel [título]`.
- `/delchannel ID`
- `/welcome ID on|off`
- `/welcometext ID texto`
- `/captcha ID on|off`
- `/setreport ID_CANAL ID_CANAL_REPORTE`
- `/blacklist_add ID|@username [motivo]` o `/globalban ID|@username [motivo]`
- `/blacklist_remove ID|@username` o `/globalunban ID|@username`
- `/route_add ORIGEN DESTINO`, `/route_remove ORIGEN DESTINO`, `/routes`
- `/template_set ID_CANAL TIPO FORMATO texto`
- `/template_list ID_CANAL`
- `/template_buttons ID_CANAL TIPO JSON`
- `/template_delete ID_CANAL TIPO`
- `/publish ID_CANAL texto` — o responde a un mensaje con `/publish ID_CANAL` para copiarlo.
- `/publish_paid ID_CANAL PRECIO_STARS texto` — o responde a un mensaje con `/publish_paid ID_CANAL PRECIO_STARS`.
- `/stats`
- `/addadmin ID` y `/deladmin ID` — solo el propietario.

## Requisitos de Telegram

- Activar Telegram Serverless para el bot correcto en @BotFather.
- Mantener el secreto de repositorio `TGCLOUD_TOKEN` con el **CLI Access Token de Serverless**, nunca el token normal del Bot API.
- Dar al bot los permisos de administrador necesarios en los canales y grupos conectados.
- El propietario está configurado en `OWNER_ID` dentro de `tgcloud/handlers/message.js` y `tgcloud/handlers/callback_query.js`; ambos valores deben coincidir con el ID numérico real del propietario.
- Configurar `/setreport` para cada canal que deba enviar avisos a un chat de reportes.

## Límites que aún requieren prueba funcional

- La validación de GitHub comprueba sintaxis; no puede confirmar por sí sola los permisos reales de cada canal ni completar una compra de prueba.
- Las publicaciones de pago deben probarse en Telegram con una compra de prueba de Stars antes de anunciarse públicamente. El flujo de reembolso no está implementado.
- Las publicaciones multimedia se pueden copiar individualmente. La agrupación de un álbum como un único envío no está garantizada en esta versión Serverless.
- El CAPTCHA no dispone de temporizador de fondo; el vencimiento se procesa cuando llega la interacción del usuario.
- Los botones aceptan campos adicionales como `icon_custom_emoji_id` o `style` en el JSON, pero la representación final depende de que la versión actual de Telegram Bot API los admita.

## Plataforma y despliegue

- JavaScript ES modules en `tgcloud/`, con SDK oficial `sdk` y base de datos integrada.
- No usa Telegraf, polling, procesos permanentes ni filesystem en tiempo de ejecución.
- Cada push a `main` ejecuta validación, sincroniza módulos, aplica migraciones seguras y sincroniza el webhook.
- No guardes tokens en el repositorio ni compartas capturas que los muestren.
