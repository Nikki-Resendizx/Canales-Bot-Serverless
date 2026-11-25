# Programaciones y distribución múltiple

## Arquitectura

- `scheduled_publications` conserva el origen, mensaje, fecha de ejecución y estado.
- `scheduled_publication_targets` permite asociar varios destinos a una programación.
- `recipient_lists` y `recipient_list_items` contienen listas reutilizables de canales y grupos.
- `repeat_jobs` conserva la recurrencia y el número de ejecuciones restantes.
- `forward_history` registra cada entrega por destino para evitar duplicados en reintentos.

La distribución múltiple se modela como un grafo de relaciones origen-destino. Un origen puede tener varias filas en `channel_routes`; varios orígenes pueden apuntar al mismo destino. Una colección de rutas forma una distribución de varios orígenes a varios destinos.

## Ejecución programada

Telegram Serverless no mantiene temporizadores activos entre actualizaciones. Por eso esta rama incorpora `tgcloud-cron` como disparador externo y ejecuta el módulo desplegado `lib/cron/processScheduled` cada cinco minutos mediante GitHub Actions.

El workflow necesita el secreto `TGCLOUD_TOKEN` (CLI Access Token de Telegram Serverless). El calendario usa UTC y su granularidad efectiva es de cinco minutos. No debe anunciarse como ejecución exacta al segundo.

## Activación controlada

1. Instalar dependencias con `npm install`.
2. Ejecutar `npx tgcron check`.
3. Desplegar los módulos y aplicar la migración segura de `tgcloud/schema.js`.
4. Confirmar que el secreto `TGCLOUD_TOKEN` existe en GitHub Actions.
5. Ejecutar manualmente el workflow y revisar el resultado antes de habilitar el cron automático.

## Seguridad y límites

El job solo entrega mensajes entre chats registrados y activos, descarta el mismo origen como destino, limita cada tick a 40 programaciones y registra cada entrega. La administración visual de listas y el asistente de creación de programaciones deben conectarse al panel antes de considerar terminada la experiencia de usuario.
