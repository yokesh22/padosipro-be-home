import type { ErrorRequestHandler } from 'express';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import { statusCodeToErrorCode, type ErrorResponse } from '../utils/apiResponse.js';

// ApiError carries its own status. Errors from Express/body-parser (e.g.
// malformed JSON) carry a 4xx `status`. Anything else is a 500.
const getStatusCode = (error: Error): number => {
    if (error instanceof ApiError) {
        return error.statusCode;
    }
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
};

// Express 5 forwards rejected promises from async handlers here automatically
const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const statusCode = getStatusCode(error);
    const isProduction = config.env === 'production';

    if (statusCode >= 500) {
        console.error(error);
    }

    const body: ErrorResponse = {
        success: false,
        statusCode,
        message: statusCode >= 500 && isProduction ? 'Internal Server Error' : error.message,
        error: {
            code: statusCodeToErrorCode(statusCode),
            ...(error instanceof ApiError && error.details !== undefined && { details: error.details }),
            ...(!isProduction && error.stack !== undefined && { stack: error.stack }),
        },
    };

    res.status(statusCode).json(body);
};

export default errorHandler;
