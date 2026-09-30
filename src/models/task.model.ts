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
import type { Address } from './address.model.js';
import type { User } from './user.model.js';

export const TASK_TIMINGS = ['standard', 'same_day', 'express', 'scheduled'] as const;
export type TaskTiming = (typeof TASK_TIMINGS)[number];

// morning 8–12, afternoon 12–4, evening 4–8
export const TASK_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type TaskSlot = (typeof TASK_SLOTS)[number];

export const TASK_STATUSES = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Table: tasks (migrations/005_tasks.sql). users 1 ──< N tasks.
// day and slot are set only when timing = 'scheduled' (check constraint).
// No soft delete: tasks end as 'completed' or 'cancelled'.
export class Task extends Model<InferAttributes<Task>, InferCreationAttributes<Task>> {
    declare id: CreationOptional<string>;
    declare userId: ForeignKey<User['id']>;
    declare addressId: ForeignKey<Address['id'] | null>;
    declare category: string;
    declare helpType: string;
    declare service: string;
    declare timing: TaskTiming;
    declare day: CreationOptional<string | null>; // date, comes back as 'YYYY-MM-DD'
    declare slot: CreationOptional<TaskSlot | null>;
    declare details: string;
    declare status: CreationOptional<TaskStatus>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;

    static associate(models: Models): void {
        Task.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
        Task.belongsTo(models.Address, { foreignKey: 'addressId', as: 'address' });
    }
}

export const initTask = (sequelize: Sequelize): typeof Task => {
    Task.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            category: { type: DataTypes.TEXT, allowNull: false },
            helpType: { type: DataTypes.TEXT, allowNull: false },
            service: { type: DataTypes.TEXT, allowNull: false },
            timing: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [TASK_TIMINGS] } },
            day: { type: DataTypes.DATEONLY, allowNull: true },
            slot: { type: DataTypes.TEXT, allowNull: true, validate: { isIn: [TASK_SLOTS] } },
            details: { type: DataTypes.TEXT, allowNull: false },
            status: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: 'pending',
                validate: { isIn: [TASK_STATUSES] },
            },
            createdAt: DataTypes.DATE,
            updatedAt: DataTypes.DATE,
        },
        { sequelize, tableName: 'tasks', underscored: true },
    );
    return Task;
};
