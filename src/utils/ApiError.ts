class ApiError extends Error {
    readonly statusCode: number;
    readonly details: unknown;

    constructor(statusCode: number, message: string, details?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

export default ApiError;
