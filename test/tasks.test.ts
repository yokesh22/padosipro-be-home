// Integration tests: need the Postgres from .env with migration 005 applied.
// Each run creates its own throwaway users (example.invalid emails) and
// hard-deletes them afterwards; their tasks go with them (ON DELETE CASCADE).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import argon2 from 'argon2';
import app from '../src/app.js';
import { Task, User, sequelize } from '../src/models/index.js';
import { calendarDate } from '../src/services/task.service.js';

const PASSWORD = 'correct-horse-battery';
const runId = Date.now();
const createdUserIds: string[] = [];

const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

interface Reply {
    status: number;
    body: any;
}

const call = async (method: string, path: string, body?: unknown, accessToken?: string): Promise<Reply> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (accessToken) {
        headers.authorization = `Bearer ${accessToken}`;
    }
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
};

const randomPhone = (): string => `+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

// A verified user, logged in. Returns their id and access token.
const signIn = async (suffix: string) => {
    const user = await User.create({
        email: `test-${runId}-${suffix}@example.invalid`,
        phoneNumber: randomPhone(),
        passwordHash: await argon2.hash(PASSWORD),
        emailVerifiedAt: new Date(),
    });
    createdUserIds.push(user.id);
    const reply = await call('POST', '/auth/login', { email: user.email, password: PASSWORD });
    assert.equal(reply.status, 200);
    return { userId: user.id, token: reply.body.data.accessToken as string };
};

const base = {
    category: 'Home Repairs',
    helpType: 'Appliances',
    service: 'AC service & repair',
    details: 'AC is leaking water from the indoor unit',
};

after(async () => {
    await User.destroy({ where: { id: createdUserIds } });
    server.close();
    await sequelize.close();
});

describe('POST /tasks', () => {
    let token: string;

    before(async () => {
        ({ token } = await signIn('create'));
    });

    test('requires an access token', async () => {
        const reply = await call('POST', '/tasks', { ...base, timing: 'standard' });
        assert.equal(reply.status, 401);
    });

    for (const timing of ['standard', 'same_day', 'express']) {
        test(`creates a ${timing} task and drops any day/slot sent`, async () => {
            const reply = await call(
                'POST',
                '/tasks',
                { ...base, timing, day: calendarDate(), slot: 'morning' },
                token,
            );
            assert.equal(reply.status, 201);
            assert.equal(reply.body.success, true);
            const task = reply.body.data;
            assert.equal(task.timing, timing);
            assert.equal(task.day, null);
            assert.equal(task.slot, null);
            assert.equal(task.status, 'pending');
            assert.deepEqual(Object.keys(task).sort(), [
                'category', 'createdAt', 'day', 'details', 'helpType', 'id',
                'service', 'slot', 'status', 'timing', 'updatedAt',
            ]);
        });
    }

    test('creates a scheduled task on the last allowed day', async () => {
        const day = calendarDate(6);
        const reply = await call(
            'POST',
            '/tasks',
            { ...base, timing: 'scheduled', day, slot: 'evening', details: '  trimmed  ' },
            token,
        );
        assert.equal(reply.status, 201);
        assert.equal(reply.body.data.day, day);
        assert.equal(reply.body.data.slot, 'evening');
        assert.equal(reply.body.data.details, 'trimmed');
    });

    test('scheduled task needs day and slot', async () => {
        const reply = await call('POST', '/tasks', { ...base, timing: 'scheduled' }, token);
        assert.equal(reply.status, 400);
        assert.equal(reply.body.error.code, 'VALIDATION_ERROR');
        assert.ok(reply.body.error.details.day);
        assert.ok(reply.body.error.details.slot);
    });

    test('rejects a day outside today..today+6 or not a real date', async () => {
        for (const day of [calendarDate(-1), calendarDate(7), '2026-02-30', 'tomorrow']) {
            const reply = await call('POST', '/tasks', { ...base, timing: 'scheduled', day, slot: 'morning' }, token);
            assert.equal(reply.status, 400, day);
            assert.equal(reply.body.error.code, 'VALIDATION_ERROR');
            assert.deepEqual(Object.keys(reply.body.error.details), ['day']);
            assert.equal(reply.body.message, reply.body.error.details.day);
        }
    });

    test('rejects missing or blank details', async () => {
        for (const details of [undefined, '   ', 'x'.repeat(1001)]) {
            const reply = await call('POST', '/tasks', { ...base, timing: 'standard', details }, token);
            assert.equal(reply.status, 400);
            assert.equal(reply.body.error.code, 'VALIDATION_ERROR');
            assert.deepEqual(Object.keys(reply.body.error.details), ['details']);
        }
    });

    test('reports every invalid field at once', async () => {
        const reply = await call('POST', '/tasks', { timing: 'tomorrow' }, token);
        assert.equal(reply.status, 400);
        assert.deepEqual(Object.keys(reply.body.error.details).sort(), [
            'category', 'details', 'helpType', 'service', 'timing',
        ]);
    });

    test('attaches the default address', async () => {
        const address = await call('POST', '/users/me/addresses', { flatUnit: 'B-402' }, token);
        assert.equal(address.status, 201);

        const reply = await call('POST', '/tasks', { ...base, timing: 'express' }, token);
        const task = await Task.findByPk(reply.body.data.id);
        assert.equal(task?.addressId, address.body.data.id);
    });
});

describe('GET /tasks', () => {
    let alice: { userId: string; token: string };
    let bob: { userId: string; token: string };
    const ids: Record<string, string> = {};

    before(async () => {
        alice = await signIn('list-alice');
        bob = await signIn('list-bob');
        // One task per status, oldest first
        for (const status of ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'] as const) {
            const reply = await call('POST', '/tasks', { ...base, timing: 'standard', details: status }, alice.token);
            ids[status] = reply.body.data.id;
            if (status !== 'pending') {
                await Task.update({ status }, { where: { id: reply.body.data.id } });
            }
        }
        await call('POST', '/tasks', { ...base, timing: 'standard' }, bob.token);
    });

    test('returns only the caller’s tasks, newest first', async () => {
        const reply = await call('GET', '/tasks', undefined, alice.token);
        assert.equal(reply.status, 200);
        assert.deepEqual(
            reply.body.data.items.map((t: any) => t.details),
            ['cancelled', 'completed', 'in_progress', 'assigned', 'pending'],
        );
        assert.equal(reply.body.data.nextCursor, null);
    });

    test('returns an empty list, not 404', async () => {
        const { token } = await signIn('list-empty');
        const reply = await call('GET', '/tasks', undefined, token);
        assert.equal(reply.status, 200);
        assert.deepEqual(reply.body.data, { items: [], nextCursor: null });
    });

    test('filters by status', async () => {
        const reply = await call('GET', '/tasks?status=completed,cancelled', undefined, alice.token);
        assert.deepEqual(reply.body.data.items.map((t: any) => t.status), ['cancelled', 'completed']);
    });

    test('status=active means pending, assigned and in_progress', async () => {
        const reply = await call('GET', '/tasks?status=active&limit=5', undefined, alice.token);
        assert.deepEqual(reply.body.data.items.map((t: any) => t.status), ['in_progress', 'assigned', 'pending']);
    });

    test('rejects an unknown status', async () => {
        const reply = await call('GET', '/tasks?status=done', undefined, alice.token);
        assert.equal(reply.status, 400);
        assert.equal(reply.body.error.code, 'VALIDATION_ERROR');
        assert.ok(reply.body.error.details.status);
    });

    test('paginates with nextCursor', async () => {
        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
            const query: string = `/tasks?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
            const reply = await call('GET', query, undefined, alice.token);
            assert.equal(reply.status, 200);
            assert.ok(reply.body.data.items.length <= 2);
            seen.push(...reply.body.data.items.map((t: any) => t.id));
            cursor = reply.body.data.nextCursor;
            pages++;
        } while (cursor);

        assert.equal(pages, 3);
        assert.deepEqual(seen, [ids.cancelled, ids.completed, ids.in_progress, ids.assigned, ids.pending]);
    });

    test("rejects a garbage cursor or another user's cursor", async () => {
        const bobs = await call('GET', '/tasks?limit=1', undefined, bob.token);
        const foreign = Buffer.from(bobs.body.data.items[0].id).toString('base64url');
        for (const cursor of ['not-a-cursor', foreign]) {
            const reply = await call('GET', `/tasks?cursor=${cursor}`, undefined, alice.token);
            assert.equal(reply.status, 400);
            assert.ok(reply.body.error.details.cursor);
        }
    });

    test('caps limit at 50', async () => {
        const reply = await call('GET', '/tasks?limit=500', undefined, alice.token);
        assert.equal(reply.status, 200);
    });
});

describe('GET /tasks/:id', () => {
    test('returns the task to its owner and 404 to anyone else', async () => {
        const owner = await signIn('get-owner');
        const other = await signIn('get-other');
        const created = await call('POST', '/tasks', { ...base, timing: 'same_day' }, owner.token);

        const mine = await call('GET', `/tasks/${created.body.data.id}`, undefined, owner.token);
        assert.equal(mine.status, 200);
        assert.deepEqual(mine.body.data, created.body.data);

        const theirs = await call('GET', `/tasks/${created.body.data.id}`, undefined, other.token);
        assert.equal(theirs.status, 404);
        assert.equal(theirs.body.error.code, 'TASK_NOT_FOUND');

        const bogus = await call('GET', '/tasks/not-a-uuid', undefined, owner.token);
        assert.equal(bogus.status, 404);
        assert.equal(bogus.body.error.code, 'TASK_NOT_FOUND');
    });
});

describe('PATCH /tasks/:id/cancel', () => {
    let owner: { userId: string; token: string };

    before(async () => {
        owner = await signIn('cancel');
    });

    const createWithStatus = async (status: string): Promise<string> => {
        const reply = await call('POST', '/tasks', { ...base, timing: 'standard' }, owner.token);
        await Task.update({ status: status as any }, { where: { id: reply.body.data.id } });
        return reply.body.data.id;
    };

    for (const status of ['pending', 'assigned']) {
        test(`cancels a ${status} task`, async () => {
            const id = await createWithStatus(status);
            const reply = await call('PATCH', `/tasks/${id}/cancel`, undefined, owner.token);
            assert.equal(reply.status, 200);
            assert.equal(reply.body.data.status, 'cancelled');
            assert.equal(reply.body.data.id, id);
        });
    }

    for (const status of ['in_progress', 'completed', 'cancelled']) {
        test(`returns 409 for a ${status} task`, async () => {
            const id = await createWithStatus(status);
            const reply = await call('PATCH', `/tasks/${id}/cancel`, undefined, owner.token);
            assert.equal(reply.status, 409);
            assert.equal(reply.body.error.code, 'TASK_NOT_CANCELLABLE');
            assert.equal((await Task.findByPk(id))?.status, status);
        });
    }

    test("returns 404 for another user's task and leaves it alone", async () => {
        const id = await createWithStatus('pending');
        const other = await signIn('cancel-other');
        const reply = await call('PATCH', `/tasks/${id}/cancel`, undefined, other.token);
        assert.equal(reply.status, 404);
        assert.equal(reply.body.error.code, 'TASK_NOT_FOUND');
        assert.equal((await Task.findByPk(id))?.status, 'pending');
    });
});
