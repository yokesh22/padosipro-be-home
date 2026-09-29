import ApiError from '../utils/ApiError.js';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

interface Entry {
    failures: number;
    windowStart: number;
}

// Failed logins per email + IP, kept in memory. It resets on restart and isn't
// shared between instances; move it to Redis or a table when we scale out.
const entries = new Map<string, Entry>();

const keyFor = (email: string, ip: string | null): string => `${email}|${ip ?? 'unknown'}`;

const liveEntry = (key: string): Entry | undefined => {
    const entry = entries.get(key);
    if (entry && Date.now() - entry.windowStart >= WINDOW_MS) {
        entries.delete(key);
        return undefined;
    }
    return entry;
};

// Drop expired windows so the map can't grow without bound
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
        if (now - entry.windowStart >= WINDOW_MS) {
            entries.delete(key);
        }
    }
}, SWEEP_INTERVAL_MS).unref();

// Throws 429 once this email + IP has used up its failed attempts.
const assertNotLocked = (email: string, ip: string | null): void => {
    const entry = liveEntry(keyFor(email, ip));
    if (entry && entry.failures >= MAX_FAILURES) {
        const waitMs = WINDOW_MS - (Date.now() - entry.windowStart);
        throw new ApiError(429, 'Too many attempts. Try again in a few minutes.', {
            retryAfterSeconds: Math.ceil(waitMs / 1000),
        });
    }
};

const recordFailure = (email: string, ip: string | null): void => {
    const key = keyFor(email, ip);
    const entry = liveEntry(key);
    if (entry) {
        entry.failures += 1;
    } else {
        entries.set(key, { failures: 1, windowStart: Date.now() });
    }
};

const reset = (email: string, ip: string | null): void => {
    entries.delete(keyFor(email, ip));
};

export default {
    assertNotLocked,
    recordFailure,
    reset,
};
