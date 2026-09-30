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
        ssl: process.env.DB_SSL === 'true',
    },
    brevo: {
        apiKey: process.env.BREVO_API_KEY ?? '',
    },
    mail: {
        fromEmail: process.env.MAIL_FROM_EMAIL ?? '',
        fromName: process.env.MAIL_FROM_NAME ?? 'PadosiPro',
    },
    otp: {
        // Secret mixed into the OTP hash (HMAC-SHA256). Long random string.
        pepper: process.env.OTP_PEPPER ?? '',
    },
    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
        accessTtlSeconds: 60 * 60, // 1 hour
    },
    refreshToken: {
        ttlDays: 60,
    },
} as const;

export default config;
