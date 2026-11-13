# Filtros de mensajes

El panel de administración incorpora **🔏 FILTROS** con tres niveles de configuración:

1. **Global:** valores base para todas las rutas.
2. **Canal:** sobrescribe únicamente las reglas de ese canal de origen.
3. **Ruta:** sobrescribe las reglas de un destino concreto.

La prioridad es **ruta → canal → global**. Los campos que no se guardan en un nivel continúan heredándose del nivel superior. El botón de herencia elimina la personalización del nivel actual.

## Configuración desde el panel

Entra en \`/admin\` → **🔏 FILTROS**. Selecciona global, canal o ruta. Cada filtro puede activarse o desactivarse y editarse respondiendo al mensaje que solicita los valores.

### Lista blanca y palabras bloqueadas

Una frase por línea. La lista blanca permite \`ANY\` (basta una coincidencia) o \`ALL\` (deben aparecer todas) en la primera línea.

Directivas opcionales:

- \`MATCH:EXACT\` o \`MATCH:PARTIAL\`
- \`CASE:SENSITIVE\` o \`CASE:INSENSITIVE\`
- \`SEARCH:TEXT\`, \`SEARCH:CAPTION\` o \`SEARCH:BOTH\`

Ejemplo:

\`\`\`text
ANY
MATCH:PARTIAL
CASE:INSENSITIVE
SEARCH:BOTH
oferta especial
promoción
\`\`\`

Las palabras bloqueadas se evalúan antes que la lista blanca.

### Regex

La expresión se considera un patrón de bloqueo: si coincide con el texto o la descripción, la publicación se rechaza. Acepta \`/expresión/flags\` o una expresión sin delimitadores (por defecto \`i\`).

### Caracteres y líneas

Formato: \`MAX_CARACTERES | MAX_LINEAS\`. Usa \`0\` para desactivar un límite.

### Franjas horarias y días

Una franja \`HH:MM-HH:MM\` por línea. Se admiten franjas que cruzan medianoche. Se puede especificar la zona horaria con \`TZ:America/Mexico_City\`.

Los días que se omiten se indican como \`1\` lunes, \`2\` martes, … \`7\` domingo.

### Enlaces

\`TEXT\` bloquea enlaces en texto/descripción, \`BUTTONS\` bloquea URL de botones inline y \`BOTH\` bloquea ambos.

### Medios

Tipos disponibles: \`text\`, \`photo\`, \`video\`, \`gif\`, \`audio\`, \`voice\`, \`document\`, \`video_note\`, \`sticker\`, \`album\`.

### Bloqueo específico

- \`FORWARDED\`: bloquea mensajes reenviados.
- \`BOTS\`: bloquea mensajes cuyo campo de origen identifique explícitamente un bot.
- \`REPEAT:MINUTOS\`: bloquea contenido repetido durante ese periodo.
- \`PATTERN: texto\`: añade una cadena excluida.
- \`CLEAR\`: limpia las reglas de este filtro.

Telegram no siempre entrega la identidad del autor en publicaciones de canal; la detección de bots solo puede actuar cuando el campo \`from.is_bot\` está presente.

### Firmas

Una firma autorizada por línea. \`MATCH:EXACT\` / \`MATCH:PARTIAL\` y \`CASE:SENSITIVE\` / \`CASE:INSENSITIVE\` controlan la comparación. \`REQUIRE\` exige que exista una firma no vacía.

La Bot API expone el texto \`author_signature\`, no un identificador verificable del administrador que publicó. Por eso esta regla valida el texto de la firma y no demuestra por sí sola la identidad de la cuenta.

### Límite de publicaciones

Formato: \`MAX_MENSAJES | MINUTOS\`. Ejemplo \`5 | 25\`. Los álbumes se cuentan como una sola publicación aunque sus elementos se entreguen individualmente.

## Rechazos

Cada filtro puede usar el comportamiento predeterminado o tener su propio comportamiento:

- **Descartar:** no distribuir y registrar el motivo.
- **Revisión:** guardar el rechazo como pendiente y enviar al propietario botones para aprobar o descartar.

El panel **Registro de rechazos** muestra los últimos 20 eventos. Los filtros se ejecutan antes de copiar o reenviar una publicación a cada ruta.

## Datos

Las tablas \`filter_configs\`, \`filter_rejections\`, \`filter_seen_content\` y \`filter_delivery_events\` son aditivas. No sustituyen las tablas actuales de canales, rutas, plantillas o publicaciones.


# Reenvíos por ruta

En **Distribución → seleccionar ruta → Opciones de reenvío** puedes ajustar cada destino por separado:

- **Avisos al propietario:** envía un aviso privado al propietario después de cada entrega confirmada. El bot debe poder iniciar conversación con el propietario.
- **Fijar publicación:** intenta fijar la copia o reenvío en el destino. El bot debe tener permiso para fijar mensajes.
- **Espera inicial:** pausa de 0 a 30 segundos antes de enviar a esa ruta.
- **Intervalo:** pausa de 0 a 30 segundos entre rutas atendidas por el mismo mensaje.

Los ajustes se guardan en \`route_forward_settings\`; no modifican el modo ni la definición de las rutas existentes. Los fallos de aviso o fijado no cancelan una distribución ya realizada.

Las tablas \`recipient_lists\`, \`recipient_list_items\`, \`scheduled_publications\`, \`repeat_jobs\` y \`forward_history\` preparan almacenamiento persistente para listas, historial y trabajos programados. **La ejecución automática de tareas programadas todavía requiere conectar un disparador compatible con TGCloud**; no se activa un temporizador en memoria, porque no sería fiable en un entorno serverless.
