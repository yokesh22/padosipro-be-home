import { Router } from 'express';
import authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-otp', authController.resendOtp);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

export default router;
