import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';

declare global {
    namespace Express {
        interface Request {
            // Set by authenticate. Only read it on routes that use that middleware.
            userId: string;
        }
    }
}

// Requires `Authorization: Bearer <accessToken>` and sets req.userId from
// the token's subject. Missing, invalid or expired tokens get a 401.
const authenticate: RequestHandler = (req, _res, next) => {
    const [scheme, token] = req.get('authorization')?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
        throw new ApiError(401, 'Missing access token');
    }

    try {
        const payload = jwt.verify(token, config.jwt.accessSecret);
        if (typeof payload === 'string' || !payload.sub) {
            throw new Error('Token has no subject');
        }
        req.userId = payload.sub;
    } catch {
        throw new ApiError(401, 'Invalid or expired access token');
    }

    next();
};

export default authenticate;
