import { Address } from '../models/index.js';
import type { Address as AddressInstance } from '../models/address.model.js';
import ApiError from '../utils/ApiError.js';
import userService, { toProfileAddress } from './user.service.js';

export interface CreateAddressInput {
    flatUnit: string;
    addressLine?: string;
    society?: string;
    notes?: string;
}

export interface AddressDto {
    id: string;
    flatUnit: string;
    addressLine: string | null;
    society: string | null;
    notes: string | null;
    isDefault: boolean;
    createdAt: Date;
}

const toDto = (address: AddressInstance): AddressDto => ({
    ...toProfileAddress(address),
    createdAt: address.createdAt,
});

// Optional text field: trimmed, blank or missing -> null.
const optionalText = (value: unknown, field: string, maxLength: number): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new ApiError(400, `${field} must be a string`);
    }
    const text = value.trim();
    if (text.length > maxLength) {
        throw new ApiError(400, `${field} must be at most ${maxLength} characters`);
    }
    return text || null;
};

// Flow: migrations/002_queries.sql, section 8b.
// Adds an address for the logged-in user. Their first address becomes the default.
const createAddress = async (userId: string, body: CreateAddressInput | undefined): Promise<AddressDto> => {
    // 1. Validate input
    const flatUnit = optionalText(body?.flatUnit, 'flatUnit', 100);
    if (!flatUnit) {
        throw new ApiError(400, 'flatUnit is required');
    }
    const addressLine = optionalText(body?.addressLine, 'addressLine', 500);
    const society = optionalText(body?.society, 'society', 200);
    const notes = optionalText(body?.notes, 'notes', 500);

    // 2. Make sure the account is still active
    await userService.findActiveUser(userId);

    // 3. Create it, as the default if it's the user's first address
    const liveCount = await Address.count({ where: { userId, deletedAt: null } });
    const address = await Address.create({
        userId,
        flatUnit,
        addressLine,
        society,
        notes,
        isDefault: liveCount === 0,
    });
    return toDto(address);
};

export default {
    createAddress,
};
