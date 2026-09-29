import { Router } from 'express';
import userController from '../controllers/user.controller.js';
import authenticate from '../middlewares/authenticate.js';

const router = Router();

// Every /users route needs a logged-in user
router.use(authenticate);

router.get('/me', userController.getMe);
router.patch('/me', userController.updateMe);
router.post('/me/addresses', userController.createAddress);

export default router;
