import {
    DataTypes,
    Model,
    type CreationOptional,
    type ForeignKey,
    type InferAttributes,
    type InferCreationAttributes,
    type Sequelize,
} from 'sequelize';
import type { Models } from './index.js';
import type { User } from './user.model.js';

export const OTP_PURPOSES = ['email_verify', 'password_reset'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

// Table: email_verification_codes (migrations/001_schema.sql). users 1 ──< N codes.
// Insert one row per code sent and never update it on resend. Issuing a new
// code sets consumed_at on older unused rows, so only the newest code works.
// code_hash must be bcrypt or HMAC-with-pepper: plain sha256 of a 6-digit
// code can be brute-forced. The row is insert-only, so it has no updated_at.
export class EmailVerificationCode extends Model<
    InferAttributes<EmailVerificationCode>,
    InferCreationAttributes<EmailVerificationCode>
> {
    declare id: CreationOptional<string>;
    declare userId: ForeignKey<User['id']>;
    declare codeHash: string;
    declare purpose: CreationOptional<OtpPurpose>;
    declare expiresAt: Date;
    declare attemptCount: CreationOptional<number>;
    declare consumedAt: CreationOptional<Date | null>;
    declare createdAt: CreationOptional<Date>;

    static associate(models: Models): void {
        EmailVerificationCode.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
}

export const initEmailVerificationCode = (sequelize: Sequelize): typeof EmailVerificationCode => {
    EmailVerificationCode.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            codeHash: { type: DataTypes.TEXT, allowNull: false },
            purpose: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: 'email_verify',
                validate: { isIn: [OTP_PURPOSES] },
            },
            expiresAt: { type: DataTypes.DATE, allowNull: false },
            attemptCount: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
            consumedAt: { type: DataTypes.DATE, allowNull: true },
            createdAt: DataTypes.DATE,
        },
        { sequelize, tableName: 'email_verification_codes', underscored: true, updatedAt: false },
    );
    return EmailVerificationCode;
};
