import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

// Replace this with your actual config from .env or hardcoded
const firebaseConfig = {
  apiKey: "demo-key", // The emulator doesn't care, but for real we need the actual key
  authDomain: "demo-domain",
  projectId: "daily-fresh-app",
  storageBucket: "demo-bucket",
  messagingSenderId: "demo-sender",
  appId: "demo-appId"
};

// Use the local emulator settings since this is a dev environment, or use the actual config
import fs from 'fs';
import path from 'path';

async function seed() {
  console.log("Reading firebase config from env...");
  // Try to load env
  const envPath = path.resolve(process.cwd(), '.env');
  let apiKey = '';
  let projectId = '';
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const keyMatch = env.match(/VITE_FIREBASE_API_KEY=(.+)/);
    const projMatch = env.match(/VITE_FIREBASE_PROJECT_ID=(.+)/);
    if (keyMatch) apiKey = keyMatch[1].trim();
    if (projMatch) projectId = projMatch[1].trim();
  }

  const app = initializeApp({
    apiKey: apiKey || "demo",
    projectId: projectId || "demo",
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  const usersToCreate = [
    { email: 'admin@gmail.com', password: 'admin@123', role: 'admin', name: 'Admin User' },
    { email: 'staff@gmail.com', password: 'staff@123', role: 'staff', name: 'Staff User' },
  ];

  for (const u of usersToCreate) {
    try {
      console.log(`Creating ${u.email}...`);
      let userCredential;
      try {
        userCredential = await createUserWithEmailAndPassword(auth, u.email, u.password);
        console.log(`Created in Auth! UID: ${userCredential.user.uid}`);
      } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
          console.log(`User ${u.email} already exists. Logging in to get UID...`);
          userCredential = await signInWithEmailAndPassword(auth, u.email, u.password);
        } else {
          throw err;
        }
      }

      const uid = userCredential.user.uid;
      
      console.log(`Writing to Firestore users collection...`);
      await setDoc(doc(db, 'users', uid), {
        uid,
        name: u.name,
        email: u.email,
        role: u.role,
        status: 'active',
        createdAt: new Date().toISOString()
      });
      console.log(`✅ Provisioned ${u.email} with role ${u.role}`);
    } catch (e) {
      console.error(`❌ Error provisioning ${u.email}:`, e);
    }
  }

  console.log("Done seeding auth.");
  process.exit(0);
}

seed();
