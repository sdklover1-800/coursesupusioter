import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import type { Role } from '@edu/shared';

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessClaims {
  sub: string; // userId
  role: Role;
  email: string;
}

/** Access-токен (короткоживущий, в Authorization: Bearer). FR-1.6 */
export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL}s`)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessKey);
  return { sub: payload.sub as string, role: payload.role as Role, email: payload.email as string };
}

/**
 * Refresh-токен (FR-1.6): случайный секрет, в httpOnly-cookie.
 * В БД храним только SHA-256 хеш (как пароль) + поддержка ротации.
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Подписанный JWT-обёртка для refresh — чтобы отличать формат и класть в cookie. */
export async function signRefreshEnvelope(jti: string, sub: string): Promise<string> {
  return new SignJWT({ jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_REFRESH_TTL}s`)
    .sign(refreshKey);
}

export async function verifyRefreshEnvelope(token: string): Promise<{ jti: string; sub: string }> {
  const { payload } = await jwtVerify(token, refreshKey);
  return { jti: payload.jti as string, sub: payload.sub as string };
}
