import { Address, User } from '../models/index.js';
import type { Address as AddressInstance } from '../models/address.model.js';
import type { User as UserInstance } from '../models/user.model.js';
import ApiError from '../utils/ApiError.js';
import type { AddressDto } from './address.service.js';

export interface UpdateMeInput {
    fullName: string;
}

// The address as it appears inside the user object (no createdAt).
export type ProfileAddress = Omit<AddressDto, 'createdAt'>;

// What the API exposes about a user. Never includes the password hash.
export interface UserProfile {
    id: string;
    email: string;
    phoneNumber: string;
    fullName: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
    defaultAddress: ProfileAddress | null;
}

export const toProfileAddress = (address: AddressInstance): ProfileAddress => ({
    id: address.id,
    flatUnit: address.flatUnit,
    addressLine: address.addressLine,
    society: address.society,
    notes: address.notes,
    isDefault: address.isDefault,
});

// Builds the profile with the user's live default address, or null. One extra
// query, served by the partial unique index idx_addresses_one_default.
const loadProfile = async (user: UserInstance): Promise<UserProfile> => {
    const defaultAddress = await Address.findOne({
        where: { userId: user.id, isDefault: true, deletedAt: null },
    });

    return {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
        defaultAddress: defaultAddress ? toProfileAddress(defaultAddress) : null,
    };
};

// Finds the live, active account behind an access token.
const findActiveUser = async (userId: string): Promise<UserInstance> => {
    const user = await User.findOne({ where: { id: userId, deletedAt: null } });
    if (!user) {
        throw new ApiError(404, 'User not found');
    }
    if (user.status !== 'active') {
        throw new ApiError(403, 'Account suspended, contact support');
    }
    return user;
};

// The logged-in user's profile.
const getMe = async (userId: string): Promise<UserProfile> => {
    const user = await findActiveUser(userId);
    return loadProfile(user);
};

// Updates the logged-in user's profile. Only fullName for now.
const updateMe = async (userId: string, body: UpdateMeInput | undefined): Promise<UserProfile> => {
    // 1. Validate input
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
    if (fullName.length < 2 || fullName.length > 100) {
        throw new ApiError(400, 'fullName must be 2 to 100 characters');
    }

    // 2. Update and return the profile
    const user = await findActiveUser(userId);
    await user.update({ fullName });
    return loadProfile(user);
};

export default {
    loadProfile,
    findActiveUser,
    getMe,
    updateMe,
};
