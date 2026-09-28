import type { ErrorRequestHandler } from 'express';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';

// Express 5 forwards rejected promises from async handlers here automatically
const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const isProduction = config.env === 'production';

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        error: {
            message: statusCode >= 500 && isProduction ? 'Internal Server Error' : error.message,
            ...(error instanceof ApiError && error.details !== undefined && { details: error.details }),
            ...(!isProduction && { stack: error.stack }),
        },
    });
};

export default errorHandler;
