import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { RefreshToken, User, sequelize } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClientInfo {
    userAgent: string | null;
    ip: string | null;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number; // access token lifetime in seconds
}

// Signed JWT, not stored in the database.
const createAccessToken = (userId: string): string => {
    if (!config.jwt.accessSecret) {
        throw new Error('JWT_ACCESS_SECRET is not set');
    }
    return jwt.sign({}, config.jwt.accessSecret, {
        subject: userId,
        expiresIn: config.jwt.accessTtlSeconds,
    });
};

// Opaque random token. Only its sha256 is stored, so a DB dump can't be used
// to hijack sessions.
const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');

// Flow: migrations/002_queries.sql, section 5a. A new login starts a new
// token family.
const issueTokens = async (userId: string, client: ClientInfo): Promise<AuthTokens> => {
    const refreshToken = randomBytes(64).toString('hex');
    await RefreshToken.create({
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + config.refreshToken.ttlDays * DAY_MS),
        userAgent: client.userAgent,
        ip: client.ip,
    });

    return {
        accessToken: createAccessToken(userId),
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: config.jwt.accessTtlSeconds,
    };
};

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

// Flow: migrations/002_queries.sql, section 6. Revokes the presented token
// and issues its successor in the same family. A token that was already
// revoked means someone replayed it, so the whole family is revoked.
const rotateTokens = async (rawToken: string, client: ClientInfo): Promise<AuthTokens> => {
    const newRefreshToken = randomBytes(64).toString('hex');

    const result = await sequelize.transaction(async (transaction) => {
        // 6a. Lock the row so two refreshes of the same token can't both rotate it
        const current = await RefreshToken.findOne({
            where: { tokenHash: hashRefreshToken(rawToken) },
            lock: true,
            transaction,
        });
        if (!current) {
            return { status: 'invalid' as const };
        }

        // 6b. Reuse detected: revoke every live token in the family (committed)
        if (current.revokedAt !== null) {
            await RefreshToken.update(
                { revokedAt: new Date() },
                { where: { familyId: current.familyId, revokedAt: null }, transaction },
            );
            return { status: 'invalid' as const };
        }
        if (current.expiresAt.getTime() <= Date.now()) {
            return { status: 'invalid' as const };
        }

        // Deleted or disabled accounts can't refresh
        const user = await User.findOne({
            where: { id: current.userId, deletedAt: null, status: 'active' },
            attributes: ['id'],
            transaction,
        });
        if (!user) {
            return { status: 'invalid' as const };
        }

        // 6c. Rotate: burn the old row, insert its successor with a fresh window
        await current.update({ revokedAt: new Date(), lastUsedAt: new Date() }, { transaction });
        await RefreshToken.create(
            {
                userId: current.userId,
                tokenHash: hashRefreshToken(newRefreshToken),
                familyId: current.familyId,
                expiresAt: new Date(Date.now() + config.refreshToken.ttlDays * DAY_MS),
                userAgent: client.userAgent,
                ip: client.ip,
            },
            { transaction },
        );
        return { status: 'rotated' as const, userId: current.userId };
    });

    if (result.status === 'invalid') {
        throw new ApiError(401, SESSION_EXPIRED);
    }

    return {
        accessToken: createAccessToken(result.userId),
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: config.jwt.accessTtlSeconds,
    };
};

// Flow: migrations/002_queries.sql, section 7a. Revokes every live token in
// the presented token's family, which signs out this device only. Unknown,
// expired or already revoked tokens are a silent no-op.
const revokeFamily = async (rawToken: string): Promise<void> => {
    await sequelize.transaction(async (transaction) => {
        const current = await RefreshToken.findOne({
            where: { tokenHash: hashRefreshToken(rawToken) },
            attributes: ['id', 'familyId'],
            lock: true,
            transaction,
        });
        if (!current) {
            return;
        }
        await RefreshToken.update(
            { revokedAt: new Date() },
            { where: { familyId: current.familyId, revokedAt: null }, transaction },
        );
    });
};

export default {
    issueTokens,
    rotateTokens,
    revokeFamily,
};
