import { Sequelize } from 'sequelize';

import config from './index.js';

// Development talks to a local Postgres without SSL. Production talks to Neon,
// which rejects non-SSL connections.
const useSsl = config.env === 'production';

const sequelize = new Sequelize(
    config.db.name,
    config.db.user,
    config.db.password,
    {
        host: config.db.host,
        port: config.db.port,
        dialect: 'postgres',

        logging: config.db.logging ? console.log : false,

        dialectOptions: useSsl
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
