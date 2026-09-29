// Integration tests: need the Postgres from .env. Each run creates its own
// throwaway users (example.invalid emails) and hard-deletes them afterwards.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import argon2 from 'argon2';
import app from '../src/app.js';
import { Address, User, sequelize } from '../src/models/index.js';

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

// A verified user who can log in with PASSWORD.
const createVerifiedUser = async (suffix: string, phoneNumber: string) => {
    const user = await User.create({
        email: `test-${runId}-${suffix}@example.invalid`,
        phoneNumber,
        passwordHash: await argon2.hash(PASSWORD),
        emailVerifiedAt: new Date(),
    });
    createdUserIds.push(user.id);
    return user;
};

const login = async (email: string) => {
    const reply = await call('POST', '/auth/login', { email, password: PASSWORD });
    assert.equal(reply.status, 200);
    return reply.body.data;
};

// Random +91 number so reruns don't collide with leftover rows
const randomPhone = (): string => `+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

after(async () => {
    await User.destroy({ where: { id: createdUserIds } });
    server.close();
    await sequelize.close();
});

describe('POST /auth/logout', () => {
    let email: string;

    before(async () => {
        email = (await createVerifiedUser('logout', randomPhone())).email;
    });

    test('returns 204 and the token no longer refreshes', async () => {
        const { refreshToken } = await login(email);

        const logout = await call('POST', '/auth/logout', { refreshToken });
        assert.equal(logout.status, 204);
        assert.equal(logout.body, null);

        const refresh = await call('POST', '/auth/refresh', { refreshToken });
        assert.equal(refresh.status, 401);
    });

    test('is idempotent: logging out twice returns 204 both times', async () => {
        const { refreshToken } = await login(email);
        assert.equal((await call('POST', '/auth/logout', { refreshToken })).status, 204);
        assert.equal((await call('POST', '/auth/logout', { refreshToken })).status, 204);
    });

    test('returns 204 for an unknown token', async () => {
        const reply = await call('POST', '/auth/logout', { refreshToken: 'not-a-real-token' });
        assert.equal(reply.status, 204);
    });

    test('returns 400 for a missing or non-string token', async () => {
        for (const body of [{}, { refreshToken: 42 }, { refreshToken: '  ' }]) {
            const reply = await call('POST', '/auth/logout', body);
            assert.equal(reply.status, 400);
            assert.equal(reply.body.success, false);
            assert.equal(reply.body.message, 'refreshToken is required');
        }
    });

    test('revokes the whole family, including rotated successors', async () => {
        const first = await login(email);
        const rotated = await call('POST', '/auth/refresh', { refreshToken: first.refreshToken });
        assert.equal(rotated.status, 200);

        // Logging out with the current token kills the family
        assert.equal((await call('POST', '/auth/logout', { refreshToken: rotated.body.data.refreshToken })).status, 204);
        assert.equal((await call('POST', '/auth/refresh', { refreshToken: rotated.body.data.refreshToken })).status, 401);
    });

    test("leaves another device's session signed in", async () => {
        const deviceA = await login(email);
        const deviceB = await login(email);

        assert.equal((await call('POST', '/auth/logout', { refreshToken: deviceA.refreshToken })).status, 204);

        const refreshB = await call('POST', '/auth/refresh', { refreshToken: deviceB.refreshToken });
        assert.equal(refreshB.status, 200);
        assert.ok(refreshB.body.data.refreshToken);
    });
});

describe('user.defaultAddress', () => {
    let email: string;

    before(async () => {
        email = (await createVerifiedUser('address', randomPhone())).email;
    });

    test('is null before any address is saved', async () => {
        const { user, accessToken } = await login(email);
        assert.equal(user.defaultAddress, null);

        const me = await call('GET', '/users/me', undefined, accessToken);
        assert.equal(me.status, 200);
        assert.equal(me.body.data.defaultAddress, null);
    });

    test('is returned by login, GET /users/me and PATCH /users/me once saved', async () => {
        const { accessToken } = await login(email);
        const created = await call(
            'POST',
            '/users/me/addresses',
            { flatUnit: 'B-402', addressLine: '12 MG Road', society: 'Green Meadows', notes: 'Gate 2' },
            accessToken,
        );
        assert.equal(created.status, 201);

        const expected = {
            id: created.body.data.id,
            flatUnit: 'B-402',
            addressLine: '12 MG Road',
            society: 'Green Meadows',
            notes: 'Gate 2',
            isDefault: true,
        };

        const relogin = await login(email);
        assert.deepEqual(relogin.user.defaultAddress, expected);

        const me = await call('GET', '/users/me', undefined, accessToken);
        assert.deepEqual(me.body.data.defaultAddress, expected);

        const patched = await call('PATCH', '/users/me', { fullName: 'Test User' }, accessToken);
        assert.equal(patched.status, 200);
        assert.deepEqual(patched.body.data.defaultAddress, expected);
    });

    test('ignores a soft-deleted default address', async () => {
        const { user } = await login(email);
        await Address.update({ deletedAt: new Date(), isDefault: false }, { where: { id: user.defaultAddress.id } });

        const relogin = await login(email);
        assert.equal(relogin.user.defaultAddress, null);
    });
});
