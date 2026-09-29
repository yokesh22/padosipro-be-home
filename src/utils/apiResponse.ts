import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';

// Every response body has this shape. Use sendSuccess() in controllers;
// errors are shaped by middlewares/errorHandler.ts (just throw ApiError).
export interface SuccessResponse<T> {
    success: true;
    statusCode: number;
    message: string;
    data: T;
}

export interface ErrorResponse {
    success: false;
    statusCode: number;
    message: string;
    error: {
        code: string; // e.g. 'BAD_REQUEST', derived from the status code
        details?: unknown;
        stack?: string;
    };
}

export type ApiResponse<T = null> = SuccessResponse<T> | ErrorResponse;

// 404 -> 'NOT_FOUND', 429 -> 'TOO_MANY_REQUESTS'
export const statusCodeToErrorCode = (statusCode: number): string =>
    (STATUS_CODES[statusCode] ?? 'Error').toUpperCase().replace(/[^A-Z0-9]+/g, '_');

export const sendSuccess = <T = null>(
    res: Response,
    statusCode: number,
    message: string,
    data: T = null as T,
): void => {
    const body: SuccessResponse<T> = { success: true, statusCode, message, data };
    res.status(statusCode).json(body);
};

// 204 has no body, so no envelope either.
export const sendNoContent = (res: Response): void => {
    res.status(204).end();
};
