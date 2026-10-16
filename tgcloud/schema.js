import { table, integer, text } from 'sdk/db';

// Claves explícitas para mantener el esquema sencillo y compatible con SQLite.
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

export const reactionReports = table('reaction_reports', {
  reportKey: text('report_key').primaryKey(),
  channelId: integer('channel_id').notNull(),
  messageId: integer('message_id').notNull(),
  userId: integer('user_id').notNull(),
  reaction: text('reaction').notNull(),
  createdAt: integer('created_at').notNull(),
});
