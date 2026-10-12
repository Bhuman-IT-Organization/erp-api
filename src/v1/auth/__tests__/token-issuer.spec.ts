/**
 * The key pair is generated per run and never leaves this process; no PEM is written anywhere.
 */
import { SignJWT, decodeProtectedHeader, exportPKCS8, generateKeyPair, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { TokenIssuer } from '../service/token-issuer.js';
import type { TokenClaims } from '../model/auth.model.js';

const ISSUER = 'erp-api';
const AUDIENCE = 'erp-web';
const TTL_MS = 900_000;

const claims: TokenClaims = {
  sub: '42',
  sid: 'sid-1',
  jti: 'jti-1',
  ver: 3,
  admin: false,
  roles: [2],
};

async function pemBase64(): Promise<{ pem: string; privateKey: CryptoKey }> {
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const pem = Buffer.from(await exportPKCS8(privateKey), 'utf8').toString('base64');
  return { pem, privateKey };
}

describe('TokenIssuer', () => {
  let issuer: TokenIssuer;
  let ownPrivateKey: CryptoKey;

  beforeAll(async () => {
    const { pem, privateKey } = await pemBase64();
    ownPrivateKey = privateKey;
    issuer = await TokenIssuer.create({
      privateKeyPemBase64: pem,
      issuer: ISSUER,
      audience: AUDIENCE,
      accessTtlMs: TTL_MS,
    });
  });

  it('round-trips: sign then verify returns the claims with exp', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = await issuer.sign(claims);
    expect(expiresAt).toBeGreaterThanOrEqual(before + TTL_MS / 1000);
    const verified = await issuer.verify(token);
    expect(verified).toEqual({ ...claims, exp: expiresAt });
  });

  it('puts the kid in the protected header, equal to issuer.kid and the JWKS kid', async () => {
    const { token } = await issuer.sign(claims);
    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe(issuer.kid);
    expect(issuer.jwks().keys[0]?.kid).toBe(issuer.kid);
    expect(issuer.kid.length).toBeGreaterThan(20);
  });

  it('publishes a JWKS with exactly kty, n, e, alg, use, kid and no private members', () => {
    const jwks = issuer.jwks();
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0] as Record<string, unknown>;
    expect(Object.keys(key).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(key).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(key).not.toHaveProperty(member);
    }
    expect(Object.isFrozen(jwks)).toBe(true);
  });

  it('rejects an HS256 token signed with the public modulus as the secret (alg confusion)', async () => {
    const secret = new TextEncoder().encode(issuer.jwks().keys[0]?.n ?? '');
    const forged = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256', kid: issuer.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secret);
    await expect(issuer.verify(forged)).resolves.toBeNull();
  });

  it('rejects a token signed by a different key pair (with the right kid)', async () => {
    const { privateKey } = await generateKeyPair('RS256', {
      modulusLength: 2048,
      extractable: true,
    });
    const foreign = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: issuer.kid })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
    await expect(issuer.verify(foreign)).resolves.toBeNull();
  });

  it('rejects a token with an unknown kid', async () => {
    const wrongKid = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'not-our-kid' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(ownPrivateKey);
    await expect(issuer.verify(wrongKid)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: issuer.kid })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(ownPrivateKey);
    await expect(issuer.verify(expired)).resolves.toBeNull();
  });

  it('rejects a wrong audience and a wrong issuer', async () => {
    const build = (iss: string, aud: string) =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: issuer.kid })
        .setSubject(claims.sub)
        .setIssuer(iss)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(ownPrivateKey);
    await expect(issuer.verify(await build(ISSUER, 'someone-else'))).resolves.toBeNull();
    await expect(issuer.verify(await build('someone-else', AUDIENCE))).resolves.toBeNull();
  });

  it('rejects an alg:none token and garbage strings without throwing', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', kid: issuer.kid })}.${b64({ ...claims, iss: ISSUER, aud: AUDIENCE, exp: 9_999_999_999 })}.`;
    await expect(issuer.verify(none)).resolves.toBeNull();
    await expect(issuer.verify('')).resolves.toBeNull();
    await expect(issuer.verify('not.a.jwt')).resolves.toBeNull();
  });

  it('returns null when the payload does not match the claim schema', async () => {
    const badShape = await new SignJWT({ sid: 'x', ver: 'not-a-number' })
      .setProtectedHeader({ alg: 'RS256', kid: issuer.kid })
      .setSubject('42')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(ownPrivateKey);
    await expect(issuer.verify(badShape)).resolves.toBeNull();
  });

  it('throws "not initialised" before init()', async () => {
    const { pem } = await pemBase64();
    const bare = new TokenIssuer(undefined, {
      privateKeyPemBase64: pem,
      issuer: ISSUER,
      audience: AUDIENCE,
      accessTtlMs: TTL_MS,
    });
    expect(() => bare.kid).toThrow('TokenIssuer not initialised');
    expect(() => bare.jwks()).toThrow('TokenIssuer not initialised');
    await expect(bare.sign(claims)).rejects.toThrow('TokenIssuer not initialised');
    await expect(bare.verify('x')).rejects.toThrow('TokenIssuer not initialised');
  });

  it('refuses construction without config or options', () => {
    expect(() => new TokenIssuer()).toThrow('TokenIssuer needs AppConfig or TokenIssuerOptions');
  });
});
