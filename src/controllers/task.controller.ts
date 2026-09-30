import type { RequestHandler } from 'express';
import taskService from '../services/task.service.js';
import type { CreateTaskInput, ListTasksQuery, TaskDto, TaskPage } from '../services/task.service.js';
import { sendSuccess, type ApiResponse } from '../utils/apiResponse.js';

// POST /api/tasks
const createTask: RequestHandler<Record<string, never>, ApiResponse<TaskDto>, CreateTaskInput> = async (req, res) => {
    const task = await taskService.createTask(req.userId, req.body);
    sendSuccess(res, 201, 'Request created', task);
};

// GET /api/tasks
const listTasks: RequestHandler<Record<string, never>, ApiResponse<TaskPage>, unknown, ListTasksQuery> = async (
    req,
    res,
) => {
    const page = await taskService.listTasks(req.userId, req.query);
    sendSuccess(res, 200, 'Tasks', page);
};

// GET /api/tasks/:id
const getTask: RequestHandler<{ id: string }, ApiResponse<TaskDto>> = async (req, res) => {
    const task = await taskService.getTask(req.userId, req.params.id);
    sendSuccess(res, 200, 'Task', task);
};

// PATCH /api/tasks/:id/cancel
const cancelTask: RequestHandler<{ id: string }, ApiResponse<TaskDto>> = async (req, res) => {
    const task = await taskService.cancelTask(req.userId, req.params.id);
    sendSuccess(res, 200, 'Request cancelled', task);
};

export default {
    createTask,
    listTasks,
    getTask,
    cancelTask,
};
