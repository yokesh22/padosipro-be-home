import type { RequestHandler } from 'express';
import userService from '../services/user.service.js';
import type { UpdateMeInput, UserProfile } from '../services/user.service.js';
import addressService from '../services/address.service.js';
import type { AddressDto, CreateAddressInput } from '../services/address.service.js';
import { sendSuccess, type ApiResponse } from '../utils/apiResponse.js';

// GET /api/users/me
const getMe: RequestHandler<Record<string, never>, ApiResponse<UserProfile>> = async (req, res) => {
    const profile = await userService.getMe(req.userId);
    sendSuccess(res, 200, 'Profile', profile);
};

// PATCH /api/users/me
const updateMe: RequestHandler<Record<string, never>, ApiResponse<UserProfile>, UpdateMeInput> = async (req, res) => {
    const profile = await userService.updateMe(req.userId, req.body);
    sendSuccess(res, 200, 'Profile updated', profile);
};

// POST /api/users/me/addresses
const createAddress: RequestHandler<Record<string, never>, ApiResponse<AddressDto>, CreateAddressInput> = async (
    req,
    res,
) => {
    const address = await addressService.createAddress(req.userId, req.body);
    sendSuccess(res, 201, 'Address added', address);
};

export default {
    getMe,
    updateMe,
    createAddress,
};
