import { db, pool } from './db/client.js'; import { identities } from './db/schema.js';
await db.insert(identities).values([{ source: 'demo', externalUserId: 'demo-user-a', displayName: 'Demo User A' }, { source: 'demo', externalUserId: 'demo-user-b', displayName: 'Demo User B' }]).onConflictDoNothing();
await pool.end();
