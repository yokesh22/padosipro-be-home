import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Op } from 'sequelize';
import config from '../config/index.js';
import { EmailVerificationCode, User, sequelize } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_MS = 30 * 1000;

const generateOtp = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

// HMAC with a secret pepper, never plain sha256: 6 digits is only 1M guesses.
const hashOtp = (otp: string): string => {
    if (!config.otp.pepper) {
        throw new Error('OTP_PEPPER is not set');
    }
    return createHmac('sha256', config.otp.pepper).update(otp).digest('hex');
};

// Constant-time compare, so response timing doesn't leak how much matched.
const isSameHash = (a: string, b: string): boolean =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Flow: migrations/002_queries.sql, section 2a.
// Throws 429 if the newest code was sent less than 30 seconds ago. The
// frontend has its own timer, but anyone can call the API directly.
const assertCooldownPassed = async (userId: string): Promise<void> => {
    const latest = await EmailVerificationCode.findOne({
        where: { userId, purpose: 'email_verify' },
        order: [['createdAt', 'DESC']],
        attributes: ['createdAt'],
    });
    if (!latest) {
        return;
    }

    const waitMs = OTP_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime());
    if (waitMs > 0) {
        throw new ApiError(429, 'Please wait before requesting a new code', {
            retryAfterSeconds: Math.ceil(waitMs / 1000),
        });
    }
};

// Flow: migrations/002_queries.sql, section 2b.
// Invalidates the user's older unused codes and stores a new one, in one
// transaction. Returns the plain code so the caller can email it.
const createEmailOtp = async (userId: string): Promise<string> => {
    const otp = generateOtp();
    console.log("tempotp = ", otp);
    await sequelize.transaction(async (transaction) => {
        await EmailVerificationCode.update(
            { consumedAt: new Date() },
            { where: { userId, purpose: 'email_verify', consumedAt: null }, transaction },
        );
        await EmailVerificationCode.create(
            {
                userId,
                codeHash: hashOtp(otp),
                purpose: 'email_verify',
                expiresAt: new Date(Date.now() + OTP_TTL_MS),
            },
            { transaction },
        );
    });
    console.log("otp generated...");
    return otp;
};

// Flow: migrations/002_queries.sql, section 3.
// Checks the newest usable code. A wrong code still commits its attempt
// before the error is thrown; a correct one is consumed and the user's email
// is marked verified, in the same transaction.
const verifyEmailOtp = async (userId: string, otp: string): Promise<void> => {
    const result = await sequelize.transaction(async (transaction) => {
        // 3a. Lock the row so two concurrent requests can't both pass the attempt check
        const code = await EmailVerificationCode.findOne({
            where: {
                userId,
                purpose: 'email_verify',
                consumedAt: null,
                expiresAt: { [Op.gt]: new Date() },
            },
            order: [['createdAt', 'DESC']],
            lock: true,
            transaction,
        });

        if (!code) {
            return 'expired';
        }
        if (code.attemptCount >= MAX_ATTEMPTS) {
            return 'too_many_attempts';
        }

        // 3b. Wrong code: burn one attempt
        if (!isSameHash(hashOtp(otp), code.codeHash)) {
            await code.increment('attemptCount', { transaction });
            return 'wrong';
        }

        // 3c. Correct code: consume it and mark the email verified
        await code.update({ consumedAt: new Date() }, { transaction });
        await User.update(
            { emailVerifiedAt: new Date() },
            { where: { id: userId, emailVerifiedAt: null }, transaction },
        );
        return 'verified';
    });

    if (result === 'expired') {
        throw new ApiError(400, 'Code expired or already used. Request a new one.');
    }
    if (result === 'too_many_attempts') {
        throw new ApiError(429, 'Too many attempts. Request a new code.');
    }
    if (result === 'wrong') {
        throw new ApiError(400, 'Invalid code');
    }
};

export default {
    assertCooldownPassed,
    createEmailOtp,
    verifyEmailOtp,
};
