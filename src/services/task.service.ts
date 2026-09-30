import { Op, type WhereOptions } from 'sequelize';
import config from '../config/index.js';
import { Address, Task, sequelize } from '../models/index.js';
import {
    TASK_SLOTS,
    TASK_STATUSES,
    TASK_TIMINGS,
    type Task as TaskInstance,
    type TaskSlot,
    type TaskStatus,
    type TaskTiming,
} from '../models/task.model.js';
import ApiError from '../utils/ApiError.js';
import userService from './user.service.js';

export interface CreateTaskInput {
    category?: unknown;
    helpType?: unknown;
    service?: unknown;
    timing?: unknown;
    day?: unknown;
    slot?: unknown;
    details?: unknown;
}

export interface ListTasksQuery {
    status?: unknown;
    limit?: unknown;
    cursor?: unknown;
}

export interface TaskDto {
    id: string;
    category: string;
    helpType: string;
    service: string;
    timing: TaskTiming;
    day: string | null;
    slot: TaskSlot | null;
    details: string;
    status: TaskStatus;
    createdAt: Date;
    updatedAt: Date;
}

export interface TaskPage {
    items: TaskDto[];
    nextCursor: string | null;
}

// The app offers today plus the next 6 days for scheduled tasks
const SCHEDULE_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const ACTIVE_STATUSES: TaskStatus[] = ['pending', 'assigned', 'in_progress'];
const CANCELLABLE_STATUSES: TaskStatus[] = ['pending', 'assigned'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDto = (task: TaskInstance): TaskDto => ({
    id: task.id,
    category: task.category,
    helpType: task.helpType,
    service: task.service,
    timing: task.timing,
    day: task.day,
    slot: task.slot,
    details: task.details,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
});

// 400 with per-field messages in error.details
const validationError = (details: Record<string, string>): ApiError => {
    const messages = Object.values(details);
    const message = messages.length === 1 ? messages[0]! : 'Please fix the highlighted fields';
    return new ApiError(400, message, details, 'VALIDATION_ERROR');
};

const taskNotFound = (): ApiError => new ApiError(404, 'Task not found', undefined, 'TASK_NOT_FOUND');

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

// Today's date as 'YYYY-MM-DD' in the app's time zone, shifted by `offsetDays`.
export const calendarDate = (offsetDays = 0, now = new Date()): string => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(now);
    const [year, month, day] = today.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
};

// Real calendar dates only: '2026-02-30' is rejected.
const isValidDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
};

// Required text: trimmed, non-empty, at most maxLength characters.
const requiredText = (
    errors: Record<string, string>,
    field: string,
    label: string,
    value: unknown,
    maxLength: number,
): string => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        errors[field] = `${label} is required`;
    } else if (text.length > maxLength) {
        errors[field] = `${label} must be at most ${maxLength} characters`;
    }
    return text;
};

// Creates a request for the logged-in user, tied to their current default address.
const createTask = async (userId: string, body: CreateTaskInput | undefined): Promise<TaskDto> => {
    // 1. Validate input, collecting every field's error
    const errors: Record<string, string> = {};
    const category = requiredText(errors, 'category', 'Category', body?.category, 80);
    const helpType = requiredText(errors, 'helpType', 'Help type', body?.helpType, 80);
    const service = requiredText(errors, 'service', 'Service', body?.service, 120);
    const details = requiredText(errors, 'details', 'Details', body?.details, 1000);

    const timing = body?.timing;
    let day: string | null = null;
    let slot: TaskSlot | null = null;
    if (!isOneOf(TASK_TIMINGS, timing)) {
        errors.timing = `Timing must be one of: ${TASK_TIMINGS.join(', ')}`;
    } else if (timing === 'scheduled') {
        // day and slot only matter for scheduled tasks; otherwise they're dropped
        const lastDay = calendarDate(SCHEDULE_WINDOW_DAYS - 1);
        if (typeof body?.day !== 'string' || !body.day) {
            errors.day = 'Pick a day for the scheduled visit';
        } else if (!isValidDate(body.day)) {
            errors.day = 'Day must be a valid date (YYYY-MM-DD)';
        } else if (body.day < calendarDate() || body.day > lastDay) {
            errors.day = `Day must be between today and ${lastDay}`;
        } else {
            day = body.day;
        }
        if (isOneOf(TASK_SLOTS, body?.slot)) {
            slot = body.slot;
        } else {
            errors.slot = `Pick a time slot: ${TASK_SLOTS.join(', ')}`;
        }
    }

    if (Object.keys(errors).length > 0 || !isOneOf(TASK_TIMINGS, timing)) {
        throw validationError(errors);
    }

    // 2. Make sure the account is still active
    await userService.findActiveUser(userId);

    // 3. Attach the default address, if they have one
    const defaultAddress = await Address.findOne({
        where: { userId, isDefault: true, deletedAt: null },
        attributes: ['id'],
    });

    const task = await Task.create({
        userId,
        addressId: defaultAddress?.id ?? null,
        category,
        helpType,
        service,
        timing,
        day,
        slot,
        details,
    });
    return toDto(task);
};

// 'active' is an alias for pending,assigned,in_progress. Missing -> no filter.
const parseStatuses = (value: unknown): TaskStatus[] | null => {
    if (value === undefined || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        throw validationError({ status: 'Status must be a comma-separated list' });
    }
    const statuses = new Set<TaskStatus>();
    for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (part === 'active') {
            ACTIVE_STATUSES.forEach((s) => statuses.add(s));
        } else if (isOneOf(TASK_STATUSES, part)) {
            statuses.add(part);
        } else {
            throw validationError({ status: `Unknown status "${part}"` });
        }
    }
    return statuses.size > 0 ? [...statuses] : null;
};

const parseLimit = (value: unknown): number => {
    if (value === undefined || value === '') {
        return DEFAULT_LIMIT;
    }
    const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!(limit >= 1)) {
        throw validationError({ limit: 'Limit must be a positive whole number' });
    }
    return Math.min(limit, MAX_LIMIT);
};

// The cursor is the base64url id of the last task on the previous page.
const encodeCursor = (taskId: string): string => Buffer.from(taskId).toString('base64url');

const decodeCursor = (value: unknown): string | null => {
    if (value === undefined || value === '') {
        return null;
    }
    const id = typeof value === 'string' ? Buffer.from(value, 'base64url').toString() : '';
    if (!UUID_RE.test(id)) {
        throw validationError({ cursor: 'Invalid cursor' });
    }
    return id;
};

// The logged-in user's tasks, newest first, keyset-paginated on (created_at, id).
const listTasks = async (userId: string, query: ListTasksQuery): Promise<TaskPage> => {
    const statuses = parseStatuses(query.status);
    const limit = parseLimit(query.limit);
    const cursorId = decodeCursor(query.cursor);

    const where: WhereOptions[] = [{ userId }];
    if (statuses) {
        where.push({ status: { [Op.in]: statuses } });
    }
    if (cursorId) {
        const exists = await Task.count({ where: { id: cursorId, userId } });
        if (!exists) {
            throw validationError({ cursor: 'Invalid cursor' });
        }
        // Compare in SQL so created_at keeps its full microsecond precision
        where.push(
            sequelize.literal(
                `("Task"."created_at", "Task"."id") < ` +
                    `(select created_at, id from tasks where id = ${sequelize.escape(cursorId)})`,
            ),
        );
    }

    const rows = await Task.findAll({
        where: { [Op.and]: where },
        order: [
            ['createdAt', 'DESC'],
            ['id', 'DESC'],
        ],
        limit: limit + 1,
    });

    const items = rows.slice(0, limit).map(toDto);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null };
};

// One of the user's tasks. Another user's task is a 404, same as a missing one.
const getTask = async (userId: string, taskId: string): Promise<TaskDto> => {
    if (!UUID_RE.test(taskId)) {
        throw taskNotFound();
    }
    const task = await Task.findOne({ where: { id: taskId, userId } });
    if (!task) {
        throw taskNotFound();
    }
    return toDto(task);
};

// Cancels a task that hasn't started yet. A single conditional update, so a
// concurrent status change by the LM can't be overwritten.
const cancelTask = async (userId: string, taskId: string): Promise<TaskDto> => {
    if (!UUID_RE.test(taskId)) {
        throw taskNotFound();
    }
    const [count, rows] = await Task.update(
        { status: 'cancelled' },
        {
            where: { id: taskId, userId, status: { [Op.in]: CANCELLABLE_STATUSES } },
            returning: true,
        },
    );
    const task = rows[0];
    if (count > 0 && task) {
        return toDto(task);
    }

    const existing = await Task.findOne({ where: { id: taskId, userId }, attributes: ['status'] });
    if (!existing) {
        throw taskNotFound();
    }
    throw new ApiError(
        409,
        `This request is ${existing.status.replace('_', ' ')} and can no longer be cancelled`,
        undefined,
        'TASK_NOT_CANCELLABLE',
    );
};

export default {
    createTask,
    listTasks,
    getTask,
    cancelTask,
};
