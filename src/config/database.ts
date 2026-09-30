// import { Sequelize } from 'sequelize';
// import config from './index.js';

// const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
//     host: config.db.host,
//     port: config.db.port,
//     dialect: 'postgres',
//     logging: config.db.logging ? console.log : false,
// });

// export default sequelize;

import { Sequelize } from 'sequelize';

import config from './index.js';

const sequelize = new Sequelize(
    config.db.name,
    config.db.user,
    config.db.password,
    {
        host: config.db.host,
        port: config.db.port,
        dialect: 'postgres',

        logging: config.db.logging ? console.log : false,

        dialectOptions: config.env === 'production'
            ? {
                ssl: {
                    require: true,
                    rejectUnauthorized: true,
                },
            }
            : {},

        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000,
        },
    },
);

export default sequelize;