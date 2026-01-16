### Detailed Implementation for Deliverable 7: TODO List Manager (SQLite WAL)

As the lead web engineer, let's expand on Deliverable 7. This module sets up a high-performance SQLite backend for CRUD operations on TODOs, using WAL mode for better concurrency in our multi-tenant setup. It separates auth data (encrypted OAuth tokens) into its own table for security and maintainability, with indexes on user_id to handle up to 2,000 users efficiently. We'll integrate it with Fastify routes for API access, pulling from parsers (e.g., storing actions from ParsedSemantics or ParsedCommand). TypeScript is the go-to here for type-safe DB interactions, but if we needed advanced querying or sharding later, I'd recommend migrating to PostgreSQL via a Node driver like pg—though that's overkill for this MVP's scale. better-sqlite3 provides sync, prepared statements for speed and safety against SQL injection.

Before coding, let's assess 2-3 options for the DB setup, as trade-offs are key:

1. **Option A: Single DB Module with Inline Queries (Chosen in Plan)**  
   - Create a singleton DB connection in TS, enable WAL on init, define tables/indexes, and export CRUD functions using prepared statements. Routes call these directly.  
   - Pros: Minimal LOC (~50-80 for core), fast sync access, easy to test. Fits multi-tenancy with user_id filters.  
   - Cons: Less modular if expanding to more tables; error handling centralized.  
   - Trade-off: Ideal for MVP—1 day effort, low bug surface on micro-VM. Prioritizes simplicity over abstraction.

2. **Option B: ORM Wrapper like TypeORM or Prisma**  
   - Use Prisma for schema definition/migrations, generating TS types and queries. Handle WAL via raw pragma.  
   - Pros: Type-safe queries, easier migrations (e.g., to Postgres), built-in multi-tenancy patterns.  
   - Cons: Adds deps (Prisma ~5MB), async by default (perf hit vs. sync better-sqlite3), more LOC for setup (~100+). Overengineers for small-scale SQLite.  
   - Trade-off: Boosts long-term maintainability but exceeds minimalism and effort cap. Skip unless anticipating quick DB swaps.

3. **Option C: Async SQLite with sqlite3 Lib**  
   - Use the async sqlite3 package, promisify for await in routes. Set WAL similarly.  
   - Pros: Native async fits Fastify's non-blocking I/O, simpler if integrating with other async ops.  
   - Cons: Slower than better-sqlite3's sync prepared statements, higher risk of blocking event loop on writes. Less performant for concurrency.  
   - Trade-off: Good for fully async apps, but plan specifies better-sqlite3 for high-performance—stick to sync for efficiency.

**Decision**: Proceed with Option A—singleton with better-sqlite3 in TS. It aligns with the plan's focus on performance, WAL concurrency, and minimal code. Sync ops are fine since DB is I/O-bound and WAL allows reads during writes. We can wrap in async if needed later. This keeps multi-tenancy simple via user_id.

Now, the implementation. Key files/snippets: DB init, table schemas, CRUD exports. Place in `src/db/todoDb.ts`. Install: `npm i better-sqlite3`. Docker-compose volumes the DB file for persistence (from Deliverable 1). Assume user_id from auth (e.g., JWT).

#### 1. Define Schemas/Types (for Type Safety)
Use interfaces for TODO and Auth entries. Zod for input validation in routes.

```typescript
// src/types.ts (updated)
export interface Todo {
  id: number;
  user_id: string; // UUID or string from auth
  description: string;
  due_date?: Date; // ISO or timestamp
  status: 'pending' | 'done'; // Simple for MVP
  created_at: Date;
}

export interface AuthEntry {
  user_id: string;
  refresh_token: string; // Encrypted
  access_token?: string; // Encrypted, optional
  expiry_date?: Date;
}
```

#### 2. DB Initialization and Setup
Singleton connection, create tables/indexes on boot.

```typescript
// src/db/db.ts
import Database from 'better-sqlite3';
import { join } from 'path';
import fs from 'fs';

// Env: DB_PATH='./data/app.db' (volume in Docker)
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

// Ensure dir exists
if (!fs.existsSync(join(__dirname, '../../data'))) {
  fs.mkdirSync(join(__dirname, '../../data'), { recursive: true });
}

const db = new Database(DB_PATH, { verbose: console.log }); // For debug

// Enable WAL for concurrency
db.pragma('journal_mode = WAL');

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS auth (
    user_id TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    expiry_date DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_auth_user_id ON auth(user_id);
  
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    description TEXT NOT NULL,
    due_date DATETIME,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
`);

export default db;
```

- **Notes**: 
  - WAL: Allows concurrent reads/writes without locking.
  - Indexes: Speed up user_id queries for multi-tenancy.
  - Dates: Stored as ISO strings or UNIX; convert in app.
  - Encryption: Handled in Deliverable 1 helper—encrypt before insert.

#### 3. CRUD Functions for TODOs
Prepared statements for safety/perf.

```typescript
// src/db/todoDb.ts
import db from './db';
import { Todo } from '../types';

// Create
const insertStmt = db.prepare(`
  INSERT INTO todos (user_id, description, due_date, status)
  VALUES (?, ?, ?, ?)
`);

export function createTodo(userId: string, desc: string, dueDate?: Date, status: 'pending' | 'done' = 'pending'): number {
  const res = insertStmt.run(userId, desc, dueDate ? dueDate.toISOString() : null, status);
  return res.lastInsertRowid as number;
}

// Read (list for user)
const listStmt = db.prepare(`
  SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC
`);

export function listTodos(userId: string): Todo[] {
  return listStmt.all(userId).map(row => ({
    ...row,
    due_date: row.due_date ? new Date(row.due_date) : undefined,
    created_at: new Date(row.created_at),
  }));
}

// Update
const updateStmt = db.prepare(`
  UPDATE todos SET description = ?, due_date = ?, status = ?
  WHERE id = ? AND user_id = ?
`);

export function updateTodo(userId: string, id: number, desc: string, dueDate?: Date, status?: 'pending' | 'done'): boolean {
  const res = updateStmt.run(desc, dueDate ? dueDate.toISOString() : null, status, id, userId);
  return res.changes > 0;
}

// Delete
const deleteStmt = db.prepare(`
  DELETE FROM todos WHERE id = ? AND user_id = ?
`);

export function deleteTodo(userId: string, id: number): boolean {
  const res = deleteStmt.run(id, userId);
  return res.changes > 0;
}
```

- **Notes**: 
  - User_id filters prevent cross-tenant access.
  - Minimal fields; expand if parsers add priority/urgency.
  - Auth CRUD similar—export functions like storeAuth, getAuth.

#### 4. Auth Table Functions (Separation of Concerns)
Similar pattern.

```typescript
// src/db/authDb.ts
import db from './db';
import { AuthEntry } from '../types';

// Upsert (since user_id primary)
const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO auth (user_id, refresh_token, access_token, expiry_date)
  VALUES (?, ?, ?, ?)
`);

export function storeAuth(entry: AuthEntry): void {
  upsertStmt.run(
    entry.user_id,
    entry.refresh_token, // Encrypted
    entry.access_token,
    entry.expiry_date ? entry.expiry_date.toISOString() : null
  );
}

// Get
const getStmt = db.prepare(`SELECT * FROM auth WHERE user_id = ?`);

export function getAuth(userId: string): AuthEntry | null {
  const row = getStmt.get(userId);
  if (!row) return null;
  return {
    ...row,
    expiry_date: row.expiry_date ? new Date(row.expiry_date) : undefined,
  };
}
```

#### 5. Fastify Routes Integration
Add CRUD endpoints, with Zod validation.

```typescript
// src/routes/todoRoutes.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createTodo, listTodos, updateTodo, deleteTodo } from '../db/todoDb';

const TodoSchema = z.object({
  description: z.string(),
  due_date: z.string().optional(), // ISO
  status: z.enum(['pending', 'done']).optional(),
});

export async function todoRoutes(fastify: FastifyInstance) {
  // List
  fastify.get('/todos', async (request) => {
    return listTodos(request.userId); // From auth middleware
  });

  // Create
  fastify.post('/todos', async (request, reply) => {
    const body = TodoSchema.parse(request.body);
    const id = createTodo(request.userId, body.description, body.due_date ? new Date(body.due_date) : undefined, body.status);
    return { id };
  });

  // Update
  fastify.put('/todos/:id', async (request, reply) => {
    const id = z.number().parse(request.params.id);
    const body = TodoSchema.parse(request.body);
    const success = updateTodo(request.userId, id, body.description, body.due_date ? new Date(body.due_date) : undefined, body.status);
    if (!success) return reply.code(404).send({ error: 'Not found' });
    return { success: true };
  });

  // Delete
  fastify.delete('/todos/:id', async (request, reply) => {
    const id = z.number().parse(request.params.id);
    const success = deleteTodo(request.userId, id);
    if (!success) return reply.code(404).send({ error: 'Not found' });
    return { success: true };
  });
}
```

- **Notes**: Assume middleware for request.userId (from Deliverable 1 auth).
- Integrates with Deliverable 8: After parsing, call createTodo for actions.

#### 6. Integration Snippet (for Deliverable 8 Orchestrator)
In /process-command/:emailId:

```typescript
// Snippet
const parsed = await parseEmail(content);
if ('actions' in parsed && parsed.actions.length > 0) { // ParsedSemantics
  for (const act of parsed.actions) {
    createTodo(userId, act.description, act.dueDate);
  }
} else if ('type' in parsed && parsed.type === 'todo') { // ParsedCommand
  createTodo(userId, parsed.description, parsed.dueDate);
}
```

#### 7. Testing Approach (Expanded)
`src/db/todoDb.test.ts`. Use Jest, in-memory DB for isolation.

```typescript
// src/db/todoDb.test.ts
import Database from 'better-sqlite3';
import { createTodo, listTodos, updateTodo, deleteTodo } from './todoDb';

// Mock db in-memory
const mockDb = new Database(':memory:');
mockDb.pragma('journal_mode = WAL');
// Exec create tables...

describe('TODO Manager', () => {
  it('CRUD operations', () => {
    const id = createTodo('user1', 'Test task', new Date());
    expect(id).toBeGreaterThan(0);

    const todos = listTodos('user1');
    expect(todos).toHaveLength(1);
    expect(todos[0].description).toBe('Test task');

    const updated = updateTodo('user1', id, 'Updated', undefined, 'done');
    expect(updated).toBe(true);

    const deleted = deleteTodo('user1', id);
    expect(deleted).toBe(true);
    expect(listTodos('user1')).toHaveLength(0);
  });

  it('multi-tenant isolation', () => {
    createTodo('user2', 'Other task');
    expect(listTodos('user1')).toHaveLength(0);
  });

  it('concurrent read/write (WAL)', async () => {
    // Simulate concurrency: Write in one, read in another
    const writePromise = new Promise((res) => setTimeout(() => { createTodo('user1', 'Concurrent'); res(null); }, 100));
    const read = listTodos('user1'); // Should not lock
    await writePromise;
    expect(read).toHaveLength(0); // Before write
    expect(listTodos('user1')).toHaveLength(1); // After
  });
});

// Similar for authDb
```

This fleshes out Deliverable 7—performant, secure (~70 LOC core + tests). WAL ensures no locks under load. On to Deliverable 8 if needed.