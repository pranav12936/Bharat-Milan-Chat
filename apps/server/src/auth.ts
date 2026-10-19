import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const key = new TextEncoder().encode(config.SESSION_SECRET);

export class AuthenticationError extends Error {
  constructor(message = 'Unauthenticated') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export type Session = {
  identityId: string;
  externalUserId: string;
  source: string;
};

export async function signSession(
  session: Session,
  expiresIn = '8h',
) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setIssuer('bharat-milan-chat')
    .setAudience('bharat-milan-chat-web')
    .sign(key);
}

export async function readSession(
  token?: string,
): Promise<Session> {
  if (!token) {
    throw new AuthenticationError();
  }

  try {
    const result = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: 'bharat-milan-chat',
      audience: 'bharat-milan-chat-web',
    });

    const payload = result.payload;

    if (
      typeof payload.identityId !== 'string' ||
      !payload.identityId ||
      typeof payload.externalUserId !== 'string' ||
      !payload.externalUserId ||
      typeof payload.source !== 'string' ||
      !payload.source
    ) {
      throw new AuthenticationError('Invalid session');
    }

    return {
      identityId: payload.identityId,
      externalUserId: payload.externalUserId,
      source: payload.source,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    throw new AuthenticationError('Invalid or expired session');
  }
}


export async function verifyBharatMilanToken(
  token: string,
  resolveDisplayName?: (userId: string, token: string) => Promise<string | null>,
): Promise<{ userId: string; displayName: string }> {
  const secret = config.BHARAT_MILAN_JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error('Bharat Milan JWT verification is not configured');
  }

  if (!token || token.length > 10000) {
    throw new Error('Invalid Bharat Milan token');
  }

  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(secret),
    {
      algorithms: ['HS256'],
      issuer: 'bharat-milan',
      audience: 'bharat-milan-app',
    },
  );

  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.sid !== 'string' ||
    !payload.sid
  ) {
    throw new Error('Invalid Bharat Milan session token');
  }

  const resolvedName = resolveDisplayName
    ? await resolveDisplayName(payload.sub, token)
    : null;

  return {
    userId: payload.sub,
    displayName: resolvedName?.trim().slice(0, 120) || 'Bharat Milan Member',
  };
}
