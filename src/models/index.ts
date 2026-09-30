import sequelize from '../config/database.js';
import { initUser } from './user.model.js';
import { initAddress } from './address.model.js';
import { initEmailVerificationCode } from './emailVerificationCode.model.js';
import { initRefreshToken } from './refreshToken.model.js';
import { initTask } from './task.model.js';

// Register every model here
const models = {
    User: initUser(sequelize),
    Address: initAddress(sequelize),
    EmailVerificationCode: initEmailVerificationCode(sequelize),
    RefreshToken: initRefreshToken(sequelize),
    Task: initTask(sequelize),
};

export type Models = typeof models;

// Wire up associations once every model is registered
Object.values(models).forEach((model) => {
    model.associate(models);
});

export { sequelize, models };
export const { User, Address, EmailVerificationCode, RefreshToken, Task } = models;
