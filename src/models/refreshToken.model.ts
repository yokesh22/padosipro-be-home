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

// Table: refresh_tokens (migrations/001_schema.sql). users 1 ──< N tokens, one per device/session.
// Store only the sha256 of the raw token. Rotation revokes the old row and
// inserts a successor with the same family_id. If a revoked token is
// presented again, treat it as theft and revoke the whole family.
export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
    declare id: CreationOptional<string>;
    declare userId: ForeignKey<User['id']>;
    declare tokenHash: string;
    declare familyId: string;
    declare expiresAt: Date;
    declare revokedAt: CreationOptional<Date | null>;
    declare userAgent: CreationOptional<string | null>;
    declare ip: CreationOptional<string | null>;
    declare createdAt: CreationOptional<Date>;
    declare lastUsedAt: CreationOptional<Date | null>;

    static associate(models: Models): void {
        RefreshToken.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
}

export const initRefreshToken = (sequelize: Sequelize): typeof RefreshToken => {
    RefreshToken.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            tokenHash: { type: DataTypes.TEXT, allowNull: false, unique: true },
            familyId: { type: DataTypes.UUID, allowNull: false },
            expiresAt: { type: DataTypes.DATE, allowNull: false },
            revokedAt: { type: DataTypes.DATE, allowNull: true },
            userAgent: { type: DataTypes.TEXT, allowNull: true },
            ip: { type: DataTypes.INET, allowNull: true },
            createdAt: DataTypes.DATE,
            lastUsedAt: { type: DataTypes.DATE, allowNull: true },
        },
        { sequelize, tableName: 'refresh_tokens', underscored: true, updatedAt: false },
    );
    return RefreshToken;
};
