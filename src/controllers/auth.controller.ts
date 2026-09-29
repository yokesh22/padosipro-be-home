import type { Request, RequestHandler } from 'express';
import authService from '../services/auth.service.js';
import type {
    LoginInput,
    LoginResult,
    RefreshInput,
    RegisterInput,
    ResendOtpInput,
    VerifyEmailInput,
    VerifyEmailResult,
} from '../services/auth.service.js';
import type { AuthTokens, ClientInfo } from '../services/token.service.js';
import { sendNoContent, sendSuccess, type ApiResponse } from '../utils/apiResponse.js';

const clientInfo = (req: Request): ClientInfo => ({
    userAgent: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
});

// POST /api/auth/register
// 202: the account isn't usable until the emailed code is verified. A verified
// email or a taken phone number gets 409 (see authService.register).
const register: RequestHandler<Record<string, never>, ApiResponse, RegisterInput> = async (req, res) => {
    await authService.register(req.body);
    sendSuccess(res, 202, 'We sent a verification code to your email.');
};

// POST /api/auth/login
// Email + password. Returns tokens directly, no OTP.
const login: RequestHandler<Record<string, never>, ApiResponse<LoginResult>, LoginInput> = async (req, res) => {
    const result = await authService.login(req.body, clientInfo(req));
    sendSuccess(res, 200, 'Signed in', result);
};

// POST /api/auth/verify-email
// Used after register. Signs the user in.
const verifyEmail: RequestHandler<Record<string, never>, ApiResponse<VerifyEmailResult>, VerifyEmailInput> = async (
    req,
    res,
) => {
    const result = await authService.verifyEmail(req.body, clientInfo(req));
    sendSuccess(res, 200, 'Signed in', result);
};

// POST /api/auth/resend-otp
// 202 with the same message whether or not a code was sent.
const resendOtp: RequestHandler<Record<string, never>, ApiResponse, ResendOtpInput> = async (req, res) => {
    await authService.resendOtp(req.body);
    sendSuccess(res, 202, 'If this email is waiting for verification, a new code has been sent.');
};

// POST /api/auth/refresh
// Rotates the refresh token and returns a new pair.
const refresh: RequestHandler<Record<string, never>, ApiResponse<AuthTokens>, RefreshInput> = async (req, res) => {
    const tokens = await authService.refresh(req.body, clientInfo(req));
    sendSuccess(res, 200, 'Token refreshed', tokens);
};

// POST /api/auth/logout
// Revokes this device's session. Always 204, whether or not the token existed.
const logout: RequestHandler<Record<string, never>, ApiResponse, RefreshInput> = async (req, res) => {
    await authService.logout(req.body);
    sendNoContent(res);
};

export default {
    register,
    login,
    verifyEmail,
    resendOtp,
    refresh,
    logout,
};
