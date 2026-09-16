import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { UnauthorizedError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { LoginInput, RegisterInput, CreateApiKeyInput } from './auth.validators.js';
import type { AuthTokens, UserPayload, ApiKeyResponse } from './auth.types.js';
import { hashApiKey, generateApiKey } from '../../shared/middleware/auth-utils.js';

const SALT_ROUNDS = 12;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly app: FastifyInstance,
  ) {}

  async register(data: RegisterInput): Promise<UserPayload> {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        matchSettings: {
          create: {},
        },
      },
    });

    return { id: user.id, email: user.email };
  }

  async login(data: LoginInput, ip?: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const payload: UserPayload = { id: user.id, email: user.email };

    const accessToken = this.app.jwt.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.app.jwt.sign(
      { sub: user.id },
      {
        expiresIn: '7d',
      },
    );

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'login',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: ip,
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = this.app.jwt.verify<{ sub: string }>(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const tokensPayload: UserPayload = { id: user.id, email: user.email };

    const accessToken = this.app.jwt.sign(tokensPayload, {
      expiresIn: '15m',
    });

    const newRefreshToken = this.app.jwt.sign(
      { sub: user.id },
      {
        expiresIn: '7d',
      },
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  async createApiKey(userId: string, data: CreateApiKeyInput): Promise<ApiKeyResponse> {
    const fullKey = generateApiKey();
    const keyHash = await hashApiKey(fullKey);
    const keyPrefix = fullKey.substring(0, 8);

    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        keyHash,
        keyPrefix,
        name: data.name,
        scopes: data.scopes,
        extensionId: data.extensionId,
        expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'api_key_created',
        resourceType: 'api_key',
        resourceId: apiKey.id,
        details: { name: data.name, scopes: data.scopes },
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes as string[],
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      fullKey,
    };
  }

  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!apiKey) {
      throw new NotFoundError('API key');
    }

    if (apiKey.revokedAt) {
      throw new ConflictError('API key already revoked');
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'api_key_revoked',
        resourceType: 'api_key',
        resourceId: keyId,
      },
    });
  }

  async listApiKeys(userId: string): Promise<ApiKeyResponse[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes as string[],
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    }));
  }
}
