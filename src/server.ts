import config from './config/index.js';
import app from './app.js';
import { sequelize } from './models/index.js';

const start = async (): Promise<void> => {
    try {
        await sequelize.authenticate();
        console.log('Database connection established');

        app.listen(config.port, () => {
            console.log(`Server running at http://localhost:${config.port}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

void start();
