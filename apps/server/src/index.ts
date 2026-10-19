
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { Server } from 'socket.io';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/client.js';
import {
  conversationParticipants,
  conversations,
  identities,
  mediaMessages,
  textMessages,
} from './db/schema.js';
import { AuthenticationError, readSession, signSession, verifyBharatMilanToken, type Session } from './auth.js';
import { eligible, setDemoEligibility } from './eligibility.js';
import { mediaUrl, saveMedia, validateMedia } from './storage.js';

const app = Fastify({
  logger: true,
  bodyLimit: 110_000_000,
});
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AuthenticationError) {
    return reply.code(401).send({ error: 'Unauthenticated' });
  }

  if (error instanceof Error && error.message === 'Conversation access denied') {
    return reply.code(403).send({ error: 'Conversation access denied' });
  }

  request.log.error({ err: error }, 'Unhandled request error');
  return reply.code(500).send({ error: 'Internal server error' });
});

await app.register(cookie);

await app.register(cors, {
  origin: config.WEB_ORIGIN,
  credentials: true,
});

await app.register(helmet);

await app.register(multipart, {
  limits: {
    files: 1,
    fileSize: config.MAX_VIDEO_BYTES,
  },
});

const io = new Server(app.server, {
  cors: {
    origin: config.WEB_ORIGIN,
    credentials: true,
  },
});

async function session(req: {
  cookies: Record<string, string | undefined>;
}) {
  return readSession(req.cookies.bm_chat_session);
}

async function participant(s: Session, conversationId: string) {
  const rows = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.identityId, s.identityId),
      ),
    );

  if (!rows.length) {
    throw new Error('Conversation access denied');
  }

  return rows[0];
}

async function resolveBharatMilanDisplayName(
  _userId: string,
  token: string,
): Promise<string | null> {
  try {
    const baseUrl = config.BHARAT_MILAN_API_URL.replace(/\/+$/, '');

    const response = await fetch(`${baseUrl}/api/profile/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      app.log.warn(
        { statusCode: response.status },
        'Could not retrieve Bharat Milan profile name',
      );
      return null;
    }

    const data = (await response.json()) as {
      fullName?: unknown;
    };

    if (typeof data.fullName !== 'string') {
      return null;
    }

    const fullName = data.fullName.trim();

    return fullName ? fullName.slice(0, 120) : null;
  } catch (error) {
    app.log.warn(
      { err: error },
      'Failed to retrieve Bharat Milan profile name',
    );
    return null;
  }
}

// Health check now reports Cloudinary configuration.
app.get('/health', async () => ({
  ok: true,
  storageConfigured: Boolean(
    config.CLOUDINARY_CLOUD_NAME &&
      config.CLOUDINARY_API_KEY &&
      config.CLOUDINARY_API_SECRET,
  ),
}));


app.post('/auth/bharat-milan', async (req, reply) => {
  const authorization = req.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return reply.code(401).send({
      error: 'Bharat Milan sign-in token required',
    });
  }

  let member: { userId: string; displayName: string };

  try {
    member = await verifyBharatMilanToken(
      match[1],
      resolveBharatMilanDisplayName,
    );
  } catch (error) {
    app.log.warn(
      { err: error },
      'Bharat Milan token verification failed',
    );

    return reply.code(401).send({
      error: 'Bharat Milan token is invalid or verification is not configured',
    });
  }

  const externalUserId = member.userId;
  const hasRealName =
    member.displayName.trim() !== '' &&
    member.displayName !== 'Bharat Milan Member';

  const found = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.source, 'bharat-milan'),
        eq(identities.externalUserId, externalUserId),
      ),
    );

  let identity = found[0];

  if (!identity) {
    const inserted = await db
      .insert(identities)
      .values({
        source: 'bharat-milan',
        externalUserId,
        displayName: member.displayName,
      })
      .returning();

    identity = inserted[0];
  } else if (
    hasRealName &&
    identity.displayName !== member.displayName
  ) {
    const updated = await db
      .update(identities)
      .set({ displayName: member.displayName })
      .where(eq(identities.id, identity.id))
      .returning();

    identity = updated[0] ?? identity;
  }

  if (!identity) {
    return reply.code(500).send({
      error: 'Could not create chat identity',
    });
  }

  reply.setCookie(
    'bm_chat_session',
    await signSession({
      identityId: identity.id,
      externalUserId,
      source: 'bharat-milan',
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
    },
  );

  return {
    identity: {
      id: identity.id,
      displayName: identity.displayName,
    },
  };
});

app.post('/auth/demo/:user', async (req, reply) => {
  if (config.DEMO_MODE !== 'true') {
    return reply.code(404).send();
  }

  const user = (req.params as { user: string }).user;

  const externalUserId =
    user === 'a'
      ? 'demo-user-a'
      : user === 'b'
        ? 'demo-user-b'
        : null;

  if (!externalUserId) {
    return reply.code(400).send({ error: 'Unknown demo user' });
  }

  const displayName = user === 'a' ? 'Demo User A' : 'Demo User B';

  const found = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.source, 'demo'),
        eq(identities.externalUserId, externalUserId),
      ),
    );

  const identity =
    found[0] ??
    (
      await db
        .insert(identities)
        .values({ source: 'demo', externalUserId, displayName })
        .returning()
    )[0];

  reply.setCookie(
    'bm_chat_session',
    await signSession({
      identityId: identity.id,
      externalUserId,
      source: 'demo',
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
    },
  );

  return {
    identity: {
      id: identity.id,
      displayName,
    },
  };
});

app.post('/auth/logout', async (_req, reply) => {
  reply.clearCookie('bm_chat_session', { path: '/' });
  return reply.code(204).send();
});

app.get('/auth/socket-token', async (req) => ({
  token: await signSession(await session(req), '5m'),
}));

app.get('/me', async (req) => {
  const s = await session(req);

  const row = await db
    .select()
    .from(identities)
    .where(eq(identities.id, s.identityId));

  return {
    id: s.identityId,
    displayName: row[0]?.displayName,
  };
});

app.post('/demo/eligibility', async (req, reply) => {
  if (config.DEMO_ELIGIBILITY_MODE !== 'true') {
    return reply.code(404).send();
  }

  const body = req.body as {
    status?: 'pending' | 'rejected' | 'accepted';
  };

  if (
    !body ||
    !['pending', 'rejected', 'accepted'].includes(body.status ?? '')
  ) {
    return reply.code(400).send({ error: 'Invalid status' });
  }

  setDemoEligibility('demo-user-a', 'demo-user-b', body.status!);

  return { ok: true };
});


app.post('/conversations/with/:externalUserId', async (req, reply) => {
  const s = await session(req);
  const other = (req.params as { externalUserId: string }).externalUserId;
  const body = req.body as { displayName?: unknown } | null;
  const displayName =
    typeof body?.displayName === 'string'
      ? body.displayName.trim().slice(0, 120)
      : '';

  if (
    !other ||
    other === s.externalUserId ||
    !(await eligible(s.externalUserId, other))
  ) {
    return reply.code(403).send({ error: 'Accepted interest required' });
  }

  if (!displayName) {
    return reply.code(400).send({
      error: 'The selected member profile name is required.',
    });
  }

  // Find the signed-in member and selected contact within Bharat Milan.
  let people = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.source, 'bharat-milan'),
        inArray(identities.externalUserId, [s.externalUserId, other]),
      ),
    );

  // The other member may never have opened chat before.
  const otherIdentity = people.find(
    (person) => person.externalUserId === other,
  );

  if (!otherIdentity) {
    await db
      .insert(identities)
      .values({
        source: 'bharat-milan',
        externalUserId: other,
        displayName,
      })
      .onConflictDoNothing();
  } else if (
    otherIdentity.displayName !== displayName
  ) {
    await db
      .update(identities)
      .set({ displayName })
      .where(eq(identities.id, otherIdentity.id));
  }

  // Re-fetch both identities after ensuring the contact exists.
  people = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.source, 'bharat-milan'),
        inArray(identities.externalUserId, [s.externalUserId, other]),
      ),
    );

  if (
    !people.some((person) => person.externalUserId === s.externalUserId) ||
    !people.some((person) => person.externalUserId === other)
  ) {
    return reply.code(500).send({
      error: 'Could not prepare both chat participants.',
    });
  }

  const pairKey = [s.externalUserId, other].sort().join(':');

  let conversation = (
    await db
      .select()
      .from(conversations)
      .where(eq(conversations.pairKey, pairKey))
  )[0];

  if (!conversation) {
    conversation = (
      await db
        .insert(conversations)
        .values({ pairKey })
        .returning()
    )[0];

    await db.insert(conversationParticipants).values(
      people.map((person) => ({
        conversationId: conversation.id,
        identityId: person.id,
      })),
    );
  }

  return conversation;
});


app.get('/conversations/:id/messages', async (req) => {
  const s = await session(req);
  const id = (req.params as { id: string }).id;

  await participant(s, id);

  const [textRows, imageRows] = await Promise.all([
    db
      .select()
      .from(textMessages)
      .where(eq(textMessages.conversationId, id)),
    db
      .select()
      .from(mediaMessages)
      .where(eq(mediaMessages.conversationId, id)),
  ]);

  return [...textRows, ...imageRows]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime(),
    )
    .slice(0, 50);
});

app.post('/conversations/:id/read', async (req) => {
  const s = await session(req);
  const id = (req.params as { id: string }).id;

  await participant(s, id);

  await db
    .update(conversationParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipants.conversationId, id),
        eq(conversationParticipants.identityId, s.identityId),
      ),
    );

  io.to(`conversation:${id}`).emit('conversation:read', {
    conversationId: id,
    identityId: s.identityId,
  });

  return { ok: true };
});

app.post('/conversations/:id/media', async (req, reply) => {
  const s = await session(req);
  const id = (req.params as { id: string }).id;

  try {
    await participant(s, id);
  } catch {
    return reply.code(403).send({ error: 'Conversation access denied' });
  }

  let file;
  let bytes: Buffer;

  try {
    file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: 'Choose an image to upload.' });
    }
    bytes = await file.toBuffer();
  } catch {
    return reply.code(413).send({
      error: 'The image is too large. Choose an image under 5 MB.',
    });
  }

  let mediaType;
  try {
    mediaType = validateMedia(file.mimetype, bytes.length);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : 'Invalid image file.',
    });
  }

  if (mediaType !== 'image') {
    return reply.code(400).send({ error: 'Only images can be sent here.' });
  }

  let objectKey: string;
  try {
    objectKey = await saveMedia(id, mediaType, file.mimetype, bytes);
  } catch (error) {
    req.log.error({ err: error }, 'Chat image upload failed');
    return reply.code(502).send({
      error: 'Image upload failed. Check the chat server Cloudinary configuration.',
    });
  }

  const message = (
    await db.insert(mediaMessages).values({
      conversationId: id,
      senderIdentityId: s.identityId,
      mediaType,
      objectKey,
      contentType: file.mimetype,
      byteSize: bytes.length,
    }).returning()
  )[0];

  await db.update(conversations)
    .set({ lastActivityAt: new Date() })
    .where(eq(conversations.id, id));

  io.to(`conversation:${id}`).emit('message:created', message);
  return reply.code(201).send(message);
});

app.post('/conversations/:id/messages', async (req, reply) => {
  const s = await session(req);
  const id = (req.params as { id: string }).id;

  // Only conversation participants may send messages.
  try {
    await participant(s, id);
  } catch {
    return reply.code(403).send({
      error: 'Conversation access denied',
    });
  }

  const body = req.body as { content?: unknown } | null;
  const content =
    typeof body?.content === 'string' ? body.content.trim() : '';

  if (!content || content.length > 5000) {
    return reply.code(400).send({
      error: 'Message must contain 1â€“5000 characters',
    });
  }

  const message = (
    await db
      .insert(textMessages)
      .values({
        conversationId: id,
        senderIdentityId: s.identityId,
        content,
      })
      .returning()
  )[0];

  await db
    .update(conversations)
    .set({ lastActivityAt: new Date() })
    .where(eq(conversations.id, id));

  // Deliver the same saved message to both participants.
  io.to(`conversation:${id}`).emit('message:created', message);

  return reply.code(201).send(message);
});

app.get('/media/:id/url', async (req, reply) => {
  const s = await session(req);
  const id = (req.params as { id: string }).id;

  const message = (
    await db
      .select()
      .from(mediaMessages)
      .where(eq(mediaMessages.id, id))
  )[0];

  if (!message) {
    return reply.code(404).send();
  }

  await participant(s, message.conversationId);

  return {
    url: await mediaUrl(message.objectKey),
  };
});

io.use(async (socket, next) => {
  try {
    socket.data.session = await readSession(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error('Unauthenticated'));
  }
});

io.on('connection', (socket) => {
  socket.on('conversation:join', async (id: string) => {
    try {
      await participant(socket.data.session, id);
      socket.join(`conversation:${id}`);
    } catch {
      socket.emit('error:access', {
        message: 'Conversation access denied',
      });
    }
  });
});

await app.listen({
  port: config.PORT,
  host: '0.0.0.0',
});




