import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const config = {
    env: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT) || 3000,
    db: {
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        name: process.env.DB_NAME ?? '',
        user: process.env.DB_USER ?? '',
        password: process.env.DB_PASSWORD ?? '',
        logging: process.env.DB_LOGGING === 'true',
    },
} as const;

export default config;
