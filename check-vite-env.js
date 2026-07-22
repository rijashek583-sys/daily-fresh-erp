import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');

console.log('VITE_FIREBASE_API_KEY:', env.VITE_FIREBASE_API_KEY);
console.log('VITE_FIREBASE_PROJECT_ID:', env.VITE_FIREBASE_PROJECT_ID);
console.log('VITE_FIREBASE_AUTH_DOMAIN:', env.VITE_FIREBASE_AUTH_DOMAIN);
