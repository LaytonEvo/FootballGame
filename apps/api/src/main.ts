import { buildApp } from './app.js';
import { createContext } from './bootstrap.js';

const ctx = await createContext();
const app = await buildApp(ctx);
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
