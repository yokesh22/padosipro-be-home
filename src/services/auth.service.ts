import argon2 from 'argon2';
import { UniqueConstraintError } from 'sequelize';
import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import emailService from './email.service.js';
import loginLimiter from './loginLimiter.service.js';
import otpService from './otp.service.js';
import tokenService from './token.service.js';
import type { AuthTokens, ClientInfo } from './token.service.js';
import userService from './user.service.js';
import type { UserProfile } from './user.service.js';

export interface RegisterInput {
    email: string;
    phoneNumber: string;
    password: string;
}

export interface LoginInput {
    email: string;
    password: string;
}

export interface VerifyEmailInput {
    email: string;
    otp: string;
}

export interface ResendOtpInput {
    email: string;
}

export interface RefreshInput {
    refreshToken: string;
}

export type VerifyEmailResult = AuthTokens & {
    isNewUser: boolean; // true until the profile (fullName) is filled in
    user: UserProfile;
};

export type LoginResult = AuthTokens & {
    needsProfile: boolean; // true until fullName is set; the app shows the details step
    user: UserProfile;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const OTP_PATTERN = /^[0-9]{6}$/;

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

const EMAIL_TAKEN = 'An account with this email already exists. Sign in instead.';
const PHONE_TAKEN = 'An account with this phone number already exists. Sign in instead.';
const INVALID_CREDENTIALS = 'Incorrect email or password.';
const ACCOUNT_SUSPENDED = 'Your account has been suspended.';
const EMAIL_NOT_VERIFIED = 'Please verify your email. Sign up again to get a new code.';

// Compared against when the email has no account, so a missing account takes
// as long to reject as a wrong password (flow 4a, check 1).
let dummyHash: Promise<string> | undefined;
const getDummyHash = (): Promise<string> => (dummyHash ??= argon2.hash('not-a-real-password'));

// Trimmed + lowercased email, or 400.
const parseEmail = (value: unknown): string => {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email)) {
        throw new ApiError(400, 'Enter a valid email address.');
    }
    return email;
};

// E.164 phone number with spaces/dashes removed, or 400.
const parsePhone = (value: unknown): string => {
    const phoneNumber = typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
    if (!E164_PATTERN.test(phoneNumber)) {
        throw new ApiError(400, 'Enter your phone number with the country code, e.g. +919876543210.');
    }
    return phoneNumber;
};

// New password for register. Not trimmed: spaces are allowed characters.
const parseNewPassword = (value: unknown): string => {
    const password = typeof value === 'string' ? value : '';
    if (password.length < PASSWORD_MIN_LENGTH) {
        throw new ApiError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
        throw new ApiError(400, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
    }
    return password;
};

// A 23505 on idx_users_phone_active: the number belongs to another live account.
const isPhoneConflict = (error: unknown): boolean =>
    error instanceof UniqueConstraintError && 'phone_number' in error.fields;

// Flow: migrations/002_queries.sql, sections 1 (REGISTER) and 2 (SEND OTP).
// A verified email gets 409 so the app can point the user to sign-in. An
// unverified one is taken over: new password, new phone, new OTP.
const register = async (body: RegisterInput | undefined): Promise<void> => {
    // 1. Validate input, then hash the password (never logged or returned)
    const email = parseEmail(body?.email);
    const phoneNumber = parsePhone(body?.phoneNumber);
    const passwordHash = await argon2.hash(parseNewPassword(body?.password));

    const existing = await User.findOne({ where: { email, deletedAt: null } });
    let userId: string;

    if (existing) {
        // 2a. Already verified: this is a sign-in, not a sign-up
        if (existing.emailVerifiedAt !== null) {
            throw new ApiError(409, EMAIL_TAKEN);
        }
        if (existing.status !== 'active') {
            throw new ApiError(403, ACCOUNT_SUSPENDED);
        }

        // 2b. Unverified: same cooldown as resend, then replace the details
        await otpService.assertCooldownPassed(existing.id);
        try {
            await existing.update({ passwordHash, phoneNumber });
        } catch (error) {
            if (isPhoneConflict(error)) {
                throw new ApiError(409, PHONE_TAKEN);
            }
            throw error;
        }
        userId = existing.id;
    } else {
        // 2c. New account. A unique violation here is the phone number, or an
        //     email that was registered between the lookup and this insert.
        try {
            const user = await User.create({ email, phoneNumber, passwordHash });
            userId = user.id;
        } catch (error) {
            if (isPhoneConflict(error)) {
                throw new ApiError(409, PHONE_TAKEN);
            }
            if (error instanceof UniqueConstraintError) {
                throw new ApiError(409, EMAIL_TAKEN);
            }
            throw error;
        }
    }

    // 3. Store an OTP, then email it (after the OTP transaction commits)
    const otp = await otpService.createEmailOtp(userId);
    await emailService.sendVerificationEmail(email, otp);
};

// Flow: migrations/002_queries.sql, section 4. Email + password, no OTP.
// Status and verification are checked only after the password matches, so
// this can't be used to find out which emails exist.
const login = async (body: LoginInput | undefined, client: ClientInfo): Promise<LoginResult> => {
    // 1. Validate input
    const email = parseEmail(body?.email);
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password) {
        throw new ApiError(400, 'Enter your password.');
    }

    // 2. 429 after too many failures from this email + IP
    loginLimiter.assertNotLocked(email, client.ip);

    // 3. Look up the live account (4a) and check the password. An unknown
    //    email still pays for a hash compare and gets the same 401.
    const user = await User.scope('withPassword').findOne({ where: { email, deletedAt: null } });
    const passwordMatches = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !passwordMatches) {
        loginLimiter.recordFailure(email, client.ip);
        throw new ApiError(401, INVALID_CREDENTIALS);
    }
    loginLimiter.reset(email, client.ip);

    // 4. Checks 3 and 4: suspended, then unverified
    if (user.status !== 'active') {
        throw new ApiError(403, ACCOUNT_SUSPENDED);
    }
    if (user.emailVerifiedAt === null) {
        throw new ApiError(403, EMAIL_NOT_VERIFIED, { reason: 'EMAIL_NOT_VERIFIED' });
    }

    // 5. Record the login (4b) and issue tokens (5a)
    await user.update({ lastLoginAt: new Date() });
    const tokens = await tokenService.issueTokens(user.id, client);

    return {
        ...tokens,
        needsProfile: !user.fullName,
        user: await userService.loadProfile(user),
    };
};

// Verifies the emailed OTP from register or resend, then signs the user in.
// isNewUser tells the app whether to show the profile page.
const verifyEmail = async (body: VerifyEmailInput | undefined, client: ClientInfo): Promise<VerifyEmailResult> => {
    // 1. Validate input
    const email = parseEmail(body?.email);
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';
    if (!OTP_PATTERN.test(otp)) {
        throw new ApiError(400, 'otp must be a 6-digit code');
    }

    // 2. Find the live account. An unknown email gets the same error as an
    //    expired code, so this can't be used to check which emails exist.
    const user = await User.findOne({ where: { email, deletedAt: null } });
    if (!user) {
        throw new ApiError(400, 'Code expired or already used. Request a new one.');
    }

    // 3. Check the code (flow 3). Throws on a wrong/expired code.
    await otpService.verifyEmailOtp(user.id, otp);

    // 4. Log in (flows 4b and 5a). A disabled account stays verified but
    //    gets no tokens.
    if (user.status !== 'active') {
        throw new ApiError(403, ACCOUNT_SUSPENDED);
    }
    await user.update({ lastLoginAt: new Date() });
    const tokens = await tokenService.issueTokens(user.id, client);

    return {
        ...tokens,
        isNewUser: !user.fullName,
        user: await userService.loadProfile(user),
    };
};

// Flow: migrations/002_queries.sql, section 2 (SEND / RESEND OTP).
// Sign-up only: a new code for an account that isn't verified yet. The
// password set at register is kept.
const resendOtp = async (body: ResendOtpInput | undefined): Promise<void> => {
    // 1. Validate input
    const email = parseEmail(body?.email);

    // 2. Unknown, deleted, disabled or already verified accounts: stop
    //    quietly, so the reply doesn't reveal which emails exist.
    const user = await User.findOne({ where: { email, deletedAt: null } });
    if (!user || user.status !== 'active' || user.emailVerifiedAt !== null) {
        return;
    }

    // 3. Cooldown (2a): 429 if the last code was sent under 30 seconds ago
    await otpService.assertCooldownPassed(user.id);

    // 4. Store a new OTP (2b), then email it
    const otp = await otpService.createEmailOtp(user.id);
    await emailService.sendVerificationEmail(email, otp);
};

// Shared by refresh and logout: a missing or non-string token is a 400.
const parseRefreshToken = (body: RefreshInput | undefined): string => {
    const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
    if (!refreshToken) {
        throw new ApiError(400, 'refreshToken is required');
    }
    return refreshToken;
};

// Flow: migrations/002_queries.sql, section 6.
const refresh = async (body: RefreshInput | undefined, client: ClientInfo): Promise<AuthTokens> =>
    tokenService.rotateTokens(parseRefreshToken(body), client);

// Flow: migrations/002_queries.sql, section 7a. Public like refresh: holding
// the refresh token is the proof, since the access token may have expired.
const logout = async (body: RefreshInput | undefined): Promise<void> => {
    await tokenService.revokeFamily(parseRefreshToken(body));
};

export default {
    register,
    login,
    verifyEmail,
    resendOtp,
    refresh,
    logout,
};
