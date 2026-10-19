
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  bigint,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const identities = pgTable(
  'identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: varchar('source', { length: 40 }).notNull(),
    externalUserId: varchar('external_user_id', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('identities_source_external_unique').on(
      t.source,
      t.externalUserId,
    ),
  ],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairKey: varchar('pair_key', { length: 300 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: uuid('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    identityId: uuid('identity_id')
      .references(() => identities.id, { onDelete: 'cascade' })
      .notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.identityId] })],
);

export const mediaMessages = pgTable('media_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  senderIdentityId: uuid('sender_identity_id')
    .references(() => identities.id)
    .notNull(),
  mediaType: varchar('media_type', { length: 10 }).notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull().unique(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const textMessages = pgTable('text_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  senderIdentityId: uuid('sender_identity_id')
    .references(() => identities.id)
    .notNull(),
  content: varchar('content', { length: 5000 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
