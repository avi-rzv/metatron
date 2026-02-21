import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env relative to the compiled file — works regardless of PM2 working directory.
// dist/index.js → dirname = dist/ → ../.env = packages/backend/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
