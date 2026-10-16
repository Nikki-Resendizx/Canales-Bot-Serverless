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
