import type { RequestHandler } from 'express';
import ApiError from '../utils/ApiError.js';

const notFound: RequestHandler = (req, _res, next) => {
    next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

export default notFound;
