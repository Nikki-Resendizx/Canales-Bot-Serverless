import { table, integer, text } from 'sdk/db';

// Sin claves foráneas: los vínculos se validan desde los handlers.
export const admins = table('admins', {
  userId: integer('user_id').primaryKey(),
  role: text('role').notNull().default('admin'),
  createdAt: integer('created_at').notNull(),
});

export const channels = table('channels', {
  chatId: integer('chat_id').primaryKey(),
  title: text('title').notNull().default(''),
  addedBy: integer('added_by').notNull(),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

export const channelSettings = table('channel_settings', {
  channelId: integer('channel_id').primaryKey(),
  welcomeEnabled: integer('welcome_enabled').notNull().default(0),
  welcomeText: text('welcome_text').notNull().default(''),
  captchaEnabled: integer('captcha_enabled').notNull().default(0),
  captchaQuestion: text('captcha_question').notNull().default(''),
  captchaAnswer: text('captcha_answer').notNull().default(''),
  textCorrectionEnabled: integer('text_correction_enabled').notNull().default(0),
  hashtags: text('hashtags').notNull().default(''),
  descriptionTemplate: text('description_template').notNull().default(''),
  missingDataText: text('missing_data_text').notNull().default(''),
  signatureEnabled: integer('signature_enabled').notNull().default(0),
  signatureText: text('signature_text').notNull().default(''),
  reactionReportChatId: integer('reaction_report_chat_id'),
  updatedAt: integer('updated_at').notNull(),
});

export const globalBans = table('global_bans', {
  userId: integer('user_id').primaryKey(),
  username: text('username').notNull().default(''),
  reason: text('reason').notNull().default(''),
  bannedBy: integer('banned_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const captchaSessions = table('captcha_sessions', {
  sessionKey: text('session_key').primaryKey(),
  userId: integer('user_id').notNull(),
  channelId: integer('channel_id').notNull(),
  expectedAnswer: text('expected_answer').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const channelRoutes = table('channel_routes', {
  routeKey: text('route_key').primaryKey(),
  sourceChatId: integer('source_chat_id').notNull(),
  destinationChatId: integer('destination_chat_id').notNull(),
  mode: text('mode').notNull().default('auto'),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const templates = table('templates', {
  templateKey: text('template_key').primaryKey(),
  channelId: integer('channel_id').notNull(),
  kind: text('kind').notNull().default('default'),
  body: text('body').notNull().default(''),
  format: text('format').notNull().default('HTML'),
  buttonsJson: text('buttons_json').notNull().default('[]'),
  updatedBy: integer('updated_by').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const publications = table('publications', {
  publicationKey: text('publication_key').primaryKey(),
  channelId: integer('channel_id').notNull(),
  sourceMessageId: integer('source_message_id'),
  status: text('status').notNull().default('draft'),
  starsPrice: integer('stars_price').notNull().default(0),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const purchases = table('purchases', {
  purchaseKey: text('purchase_key').primaryKey(),
  publicationKey: text('publication_key').notNull(),
  buyerId: integer('buyer_id').notNull(),
  telegramChargeId: text('telegram_charge_id').notNull().default(''),
  providerChargeId: text('provider_charge_id').notNull().default(''),
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const reactionReports = table('reaction_reports', {
  reportKey: text('report_key').primaryKey(),
  channelId: integer('channel_id').notNull(),
  messageId: integer('message_id').notNull(),
  userId: integer('user_id').notNull(),
  reaction: text('reaction').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Los eventos message_reaction_count son agregados y no identifican a cada usuario.
export const reactionCountReports = table('reaction_count_reports', {
  reportKey: text('report_key').primaryKey(),
  channelId: integer('channel_id').notNull(),
  messageId: integer('message_id').notNull(),
  countsJson: text('counts_json').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
});


// Usuarios que el bot ya ha visto; permite resolver @username sin inventar IDs.
export const knownUsers = table('known_users', {
  userId: integer('user_id').primaryKey(),
  username: text('username').notNull().default(''),
  displayName: text('display_name').notNull().default(''),
  lastSeenAt: integer('last_seen_at').notNull(),
});


// Textos editables de navegación y mensajes generales del bot.
export const botTexts = table('bot_texts', {
  textKey: text('text_key').primaryKey(),
  body: text('body').notNull().default(''),
  updatedBy: integer('updated_by').notNull(),
  updatedAt: integer('updated_at').notNull(),
});


// Claves persistentes para evitar repetir avisos de publicaciones y álbumes.
export const postAlertKeys = table('post_alert_keys', {
  alertKey: text('alert_key').primaryKey(),
  createdAt: integer('created_at').notNull(),
});


// Solicitudes de ingreso recibidas para grupos y canales administrados por el bot.
// Grupo central y temas donde se publican las notificaciones del bot.
export const notificationTopics = table('notification_topics', {
  topicKey: text('topic_key').primaryKey(),
  chatId: integer('chat_id').notNull(),
  messageThreadId: integer('message_thread_id').notNull().default(0),
  chatTitle: text('chat_title').notNull().default(''),
  updatedAt: integer('updated_at').notNull(),
});

export const joinRequests = table('join_requests', {
  requestKey: text('request_key').primaryKey(),
  chatId: integer('chat_id').notNull(),
  userId: integer('user_id').notNull(),
  requesterName: text('requester_name').notNull().default(''),
  username: text('username').notNull().default(''),
  bio: text('bio').notNull().default(''),
  inviteLink: text('invite_link').notNull().default(''),
  status: text('status').notNull().default('pending'),
  requestedAt: integer('requested_at').notNull(),
  decidedBy: integer('decided_by'),
  decidedAt: integer('decided_at'),
});

// Configuración heredable de filtros: global -> canal -> ruta.
// Un JSON por ámbito mantiene los filtros extensibles sin alterar channel_settings.
export const filterConfigs = table('filter_configs', {
  scopeKey: text('scope_key').primaryKey(),
  scopeType: text('scope_type').notNull().default('global'),
  channelId: integer('channel_id'),
  routeKey: text('route_key'),
  configJson: text('config_json').notNull().default('{}'),
  updatedBy: integer('updated_by').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

// Registro de rechazos y elementos pendientes de revisión.
export const filterRejections = table('filter_rejections', {
  rejectionKey: text('rejection_key').primaryKey(),
  sourceChatId: integer('source_chat_id').notNull(),
  destinationChatId: integer('destination_chat_id').notNull(),
  sourceMessageId: integer('source_message_id').notNull(),
  routeKey: text('route_key').notNull().default(''),
  filterKey: text('filter_key').notNull(),
  reason: text('reason').notNull(),
  behavior: text('behavior').notNull().default('discard'),
  status: text('status').notNull().default('rejected'),
  createdAt: integer('created_at').notNull(),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: integer('reviewed_at'),
});

// Huellas recientes para bloquear publicaciones repetidas sin depender de memoria local.
export const filterSeenContent = table('filter_seen_content', {
  fingerprint: text('fingerprint').primaryKey(),
  sourceChatId: integer('source_chat_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Registro idempotente de entregas usado para aplicar límites por ventana.
export const filterDeliveryEvents = table('filter_delivery_events', {
  eventKey: text('event_key').primaryKey(),
  scopeKey: text('scope_key').notNull(),
  publicationKey: text('publication_key').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});



// Opciones adicionales por ruta de distribución; se mantienen separadas
// de channel_routes para no alterar las rutas existentes.
export const routeForwardSettings = table('route_forward_settings', {
  routeKey: text('route_key').primaryKey(),
  configJson: text('config_json').notNull().default('{}'),
  updatedBy: integer('updated_by').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

// Listas reutilizables de destinatarios para futuras campañas manuales/programadas.
export const recipientLists = table('recipient_lists', {
  listKey: text('list_key').primaryKey(),
  name: text('name').notNull(),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const recipientListItems = table('recipient_list_items', {
  itemKey: text('item_key').primaryKey(),
  listKey: text('list_key').notNull(),
  chatId: integer('chat_id').notNull(),
  addedAt: integer('added_at').notNull(),
});

// Cola persistente: nunca depende de setTimeout ni de memoria del proceso.
export const scheduledPublications = table('scheduled_publications', {
  scheduleKey: text('schedule_key').primaryKey(),
  sourceChatId: integer('source_chat_id').notNull(),
  sourceMessageId: integer('source_message_id').notNull(),
  destinationChatId: integer('destination_chat_id').notNull(),
  routeKey: text('route_key').notNull().default(''),
  dueAt: integer('due_at').notNull(),
  status: text('status').notNull().default('pending'),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  processedAt: integer('processed_at'),
});

export const repeatJobs = table('repeat_jobs', {
  repeatKey: text('repeat_key').primaryKey(),
  scheduleKey: text('schedule_key').notNull(),
  intervalMinutes: integer('interval_minutes').notNull(),
  nextRunAt: integer('next_run_at').notNull(),
  remainingRuns: integer('remaining_runs').notNull().default(0),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

export const forwardHistory = table('forward_history', {
  historyKey: text('history_key').primaryKey(),
  routeKey: text('route_key').notNull(),
  sourceMessageId: integer('source_message_id').notNull(),
  destinationMessageId: integer('destination_message_id'),
  status: text('status').notNull().default('sent'),
  createdAt: integer('created_at').notNull(),
});
