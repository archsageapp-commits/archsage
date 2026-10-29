import { startServer } from './app.ts';
import { defaultPaths } from './paths.ts';

const { url } = startServer({ paths: defaultPaths() });
console.log(`Archsage: ${url}`);
