import {
    DataTypes,
    Model,
    type CreationOptional,
    type InferAttributes,
    type InferCreationAttributes,
    type Sequelize,
} from 'sequelize';
import type { Models } from './index.js';

export const ACCOUNT_TYPES = ['personal', 'business'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const USER_STATUSES = ['active', 'disabled', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// Table: users (migrations/001_schema.sql)
// Soft delete is manual: set status = 'deleted' and deleted_at together.
// Email is unique only among rows where deleted_at is null (partial index).
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare id: CreationOptional<string>;
    declare email: string; // citext, so comparisons ignore case
    declare passwordHash: string; // argon2id / bcrypt, never the plain password
    declare emailVerifiedAt: CreationOptional<Date | null>;
    declare fullName: CreationOptional<string | null>;
    declare businessName: CreationOptional<string | null>;
    declare accountType: CreationOptional<AccountType>;
    declare status: CreationOptional<UserStatus>;
    declare disabledAt: CreationOptional<Date | null>;
    declare disabledReason: CreationOptional<string | null>;
    declare deletedAt: CreationOptional<Date | null>;
    declare lastLoginAt: CreationOptional<Date | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;

    static associate(models: Models): void {
        User.hasMany(models.Address, { foreignKey: 'userId', as: 'addresses' });
        User.hasMany(models.EmailVerificationCode, { foreignKey: 'userId', as: 'emailVerificationCodes' });
        User.hasMany(models.RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
    }
}

export const initUser = (sequelize: Sequelize): typeof User => {
    User.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            email: { type: DataTypes.CITEXT, allowNull: false },
            passwordHash: { type: DataTypes.TEXT, allowNull: false },
            emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
            fullName: { type: DataTypes.TEXT, allowNull: true },
            businessName: { type: DataTypes.TEXT, allowNull: true },
            accountType: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: 'personal',
                validate: { isIn: [ACCOUNT_TYPES] },
            },
            status: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: 'active',
                validate: { isIn: [USER_STATUSES] },
            },
            disabledAt: { type: DataTypes.DATE, allowNull: true },
            disabledReason: { type: DataTypes.TEXT, allowNull: true },
            deletedAt: { type: DataTypes.DATE, allowNull: true },
            lastLoginAt: { type: DataTypes.DATE, allowNull: true },
            createdAt: DataTypes.DATE,
            updatedAt: DataTypes.DATE,
        },
        {
            sequelize,
            tableName: 'users',
            underscored: true,
            defaultScope: { attributes: { exclude: ['passwordHash'] } },
            scopes: { withPassword: { attributes: { include: ['passwordHash'] } } },
        },
    );
    return User;
};
