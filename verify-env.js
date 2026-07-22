import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');

const requiredKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID'
];

let allValid = true;
for (const key of requiredKeys) {
  if (env[key]) {
    console.log(`✅ ${key} is loaded successfully.`);
  } else {
    console.error(`❌ Missing ${key}`);
    allValid = false;
  }
}

if (allValid) {
  console.log('All Firebase environment variables are loaded correctly by Vite!');
} else {
  process.exit(1);
}
