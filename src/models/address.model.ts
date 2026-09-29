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

// Table: addresses (migrations/001_schema.sql). users 1 ──< N addresses.
// Soft delete via deleted_at. At most one is_default = true per user among
// live rows (partial unique index), so clear the old default before setting
// a new one, in the same transaction.
export class Address extends Model<InferAttributes<Address>, InferCreationAttributes<Address>> {
    declare id: CreationOptional<string>;
    declare userId: ForeignKey<User['id']>;
    declare label: CreationOptional<string | null>;
    declare flatUnit: string;
    declare addressLine: CreationOptional<string | null>; // free text, may have line breaks
    declare society: CreationOptional<string | null>;
    declare area: CreationOptional<string | null>;
    declare city: CreationOptional<string | null>;
    declare state: CreationOptional<string | null>;
    declare pincode: CreationOptional<string | null>;
    declare landmark: CreationOptional<string | null>;
    declare notes: CreationOptional<string | null>; // gate / entry instructions
    // numeric(9,6): pg returns these as strings to avoid precision loss
    declare latitude: CreationOptional<string | null>;
    declare longitude: CreationOptional<string | null>;
    declare isDefault: CreationOptional<boolean>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
    declare deletedAt: CreationOptional<Date | null>;

    static associate(models: Models): void {
        Address.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
}

export const initAddress = (sequelize: Sequelize): typeof Address => {
    Address.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            label: { type: DataTypes.TEXT, allowNull: true },
            flatUnit: { type: DataTypes.TEXT, allowNull: false },
            addressLine: { type: DataTypes.TEXT, allowNull: true },
            society: { type: DataTypes.TEXT, allowNull: true },
            area: { type: DataTypes.TEXT, allowNull: true },
            city: { type: DataTypes.TEXT, allowNull: true },
            state: { type: DataTypes.TEXT, allowNull: true },
            pincode: { type: DataTypes.TEXT, allowNull: true },
            landmark: { type: DataTypes.TEXT, allowNull: true },
            notes: { type: DataTypes.TEXT, allowNull: true },
            latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
            longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
            isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            createdAt: DataTypes.DATE,
            updatedAt: DataTypes.DATE,
            deletedAt: { type: DataTypes.DATE, allowNull: true },
        },
        { sequelize, tableName: 'addresses', underscored: true },
    );
    return Address;
};
