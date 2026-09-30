class ApiError extends Error {
    readonly statusCode: number;
    readonly details: unknown;
    // Overrides the code derived from the status (e.g. 'TASK_NOT_FOUND')
    readonly code: string | undefined;

    constructor(statusCode: number, message: string, details?: unknown, code?: string) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.details = details;
        this.code = code;
    }
}

export default ApiError;
