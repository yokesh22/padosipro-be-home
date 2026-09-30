import { Router } from 'express';
import taskController from '../controllers/task.controller.js';
import authenticate from '../middlewares/authenticate.js';

const router = Router();

// Every /tasks route needs a logged-in user, and only sees their own tasks
router.use(authenticate);

router.post('/', taskController.createTask);
router.get('/', taskController.listTasks);
router.get('/:id', taskController.getTask);
router.patch('/:id/cancel', taskController.cancelTask);

export default router;
