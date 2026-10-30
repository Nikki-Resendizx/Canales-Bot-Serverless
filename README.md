# CANALES-BOT Serverless

Migración independiente de CANALES-BOT para **ChannelPosts_RoBot**. El repositorio original `Nikki-Resendizx/Canales-bot` no se modifica.

## Configuración importada del Constructor

Se conserva el JSON exportado en `config/constructor.json` y se valida en cada ejecución de `npm run validate`. El manifiesto solicita los módulos Publicaciones, Plantillas, Hashtags y Botones. Estos módulos ya forman parte del código del bot; el manifiesto no apaga ni elimina las demás funciones existentes.

La validación confirma la versión del esquema, el nombre del proyecto, el usuario del bot, la plantilla y los módulos admitidos. No contiene el token de Telegram ni credenciales de despliegue y no realiza por sí sola una instalación ni crea una segunda instancia del bot.

## Estado de la migración

El código y los módulos están en la rama `main`. GitHub Actions valida la sintaxis; el despliegue a Telegram Serverless solo se ejecuta cuando el secreto `TGCLOUD_TOKEN` está configurado. Si falta, el trabajo de despliegue se omite y no debe asumirse que el bot esté actualizado en Telegram.

### Funciones implementadas en el código

- `/start`, `/help` y panel privado `/admin` con hasta tres botones por fila; la navegación de botones edita el mismo mensaje del panel.
- Editor de textos de navegación desde botones: selecciona una etiqueta, responde con el nuevo texto o escribe `DEFAULT` para restaurarla.
- Textos editables de navegación con `/navtexts` y `/navtext CLAVE texto`; se pueden restaurar con `/navtext CLAVE default`.
- Gestión de canales: registrar por ID y detectar el ID de un canal reenviando una publicación de ese canal; listar y quitar canales.
- Solicitudes de ingreso a grupos y canales: notificación privada a los administradores que también administran el chat, con botones para aceptar o rechazar; las decisiones quedan registradas y se pueden consultar desde 📥 SOLICITUDES DE INGRESO en el panel.
- Bienvenida editable por canal/grupo con variables `{mencion}`, `{nombre}`, `{username}`, `{userid}` y `{canal}`; los eventos de entrada se filtran para no volver a saludar por simples cambios de permisos.
- CAPTCHA aritmético por canal. Una respuesta incorrecta bloquea permanentemente al usuario en ese grupo; el vencimiento se comprueba cuando llega una respuesta, no mediante un temporizador de fondo.
- Blacklist global con resolución de `@username` cuando el bot ya ha observado a ese usuario, intento de baneo en todos los chats conectados y desbaneo global al retirarlo.
- Rutas de publicación entre varios canales origen y un destino; se conserva el reenvío cuando Telegram entrega metadatos de mensaje reenviado.
- Plantillas por canal: crear/editar desde el panel, listar, formatos AUTO/HTML/Markdown/MarkdownV2/OFF/RICH_MESSAGE y botones inline. Las variables admitidas son `{canal}`, `{descripcion}`, `{titulo}`, `{enlace}`, `{hashtags}`, `{fecha}`, `{contenido}`, `{texto}` y `{vacio}`. `{contenido}` conserva el texto original; `{texto}` puede reflejar la corrección activada; `{vacio}` desactiva cualquier modificación de esa publicación.
- Edición de botones individuales desde el panel, además de edición de teclado completo. La sintaxis admite URL completas o `t.me/...`, `callback:`, `popup:`, `alert:`, `copy:` y `share:`, con estilos de botón cuando Telegram los admite.
- Editor por canal: corrección básica de espacios/puntuación y mayúscula inicial, hashtags, plantilla de descripción insertable con `{descripcion}` y texto de respaldo si falta el contenido.
- Panel y comandos de canales compartidos entre todos los administradores autorizados del bot: todos pueden ver y configurar cualquier canal registrado donde el bot sea administrador, sin importar quién lo añadió. `addedBy` se conserva solo como dato histórico; las rutas, plantillas y ajustes existentes no se duplican ni se reinician.
- Publicaciones de texto y copia de un mensaje al canal mediante `/publish`.
- Publicaciones de pago con Telegram Stars: flujo por comandos y creación de publicaciones de texto desde el panel, factura XTR, validación pre-checkout y entrega tras confirmar el pago.
- Reportes de cambios de reacciones identificadas y reportes separados de conteos agregados. Los conteos agregados nunca se presentan como si identificaran usuarios. Los reportes de reacción usan por defecto `-1004456932813` y se pueden cambiar con `/setreport`.
- Alertas de publicaciones nuevas en canales conectados al canal de avisos `-1004424261064`.
- Estadísticas de canales, rutas, plantillas, blacklist, publicaciones, compras y reacciones.
- Registro de usuarios observados para resolver usernames sin inventar IDs.

## Comandos principales

- `/addchannel ID [título]`
- Para detectar un canal: reenvía al bot una publicación del canal y responde a ella con `/addchannel [título]`.
- `/delchannel ID`
- `/welcome ID on|off`
- `/welcometext ID texto`
- `/captcha ID on|off`
- `/correction ID on|off`
- `/hashtags ID_CANAL texto`
- `/description ID_CANAL texto` — admite `{texto}`
- `/missingdata ID_CANAL texto`
- `/setreport ID_CANAL ID_CANAL_REPORTE`
- `/blacklist_add ID|@username [motivo]` o `/globalban ID|@username [motivo]`
- `/blacklist_remove ID|@username` o `/globalunban ID|@username`
- `/route_add ORIGEN DESTINO`, `/route_remove ORIGEN DESTINO`, `/routes`
- `/navtexts` y `/navtext CLAVE texto` — editar etiquetas del panel; `/navtext CLAVE default` restaura el texto original.
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

- La validación de GitHub comprueba sintaxis JavaScript; no confirma por sí sola los permisos reales, las migraciones remotas, el webhook, la edición de mensajes manuales ni una compra real de prueba. La última configuración debe probarse en Telegram.
- Las publicaciones de pago deben probarse en Telegram con una compra de prueba de Stars antes de anunciarse públicamente. El flujo de reembolso no está implementado.
- La finalización automática puede editar texto/caption y teclado en el mensaje original. Los álbumes con varios elementos no se agrupan de forma garantizada al copiar por rutas; el contenido y los botones de un álbum sin caption pueden quedar limitados por las restricciones de edición de Telegram.
- RICH_MESSAGE se edita en el mismo mensaje de texto usando `editMessageText` con `rich_message`. Para captions multimedia solo se intenta una representación `html`/`markdown`; los bloques RichMessage no son un formato de caption.
- El CAPTCHA no dispone de temporizador de fondo; el vencimiento se procesa cuando llega la interacción del usuario.
- Los botones aceptan campos adicionales como `icon_custom_emoji_id` o `style` en el JSON, pero la representación final depende de que la versión actual de Telegram Bot API los admita.

## Plataforma y despliegue

- JavaScript ES modules en `tgcloud/`, con SDK oficial `sdk` y base de datos integrada.
- No usa Telegraf, polling, procesos permanentes ni filesystem en tiempo de ejecución.
- Cada push a `main` ejecuta validación, sincroniza módulos, aplica migraciones seguras y sincroniza el webhook.
- No guardes tokens en el repositorio ni compartas capturas que los muestren.
