import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadString, deleteObject } from 'firebase/storage';
import * as dotenv from 'dotenv';

dotenv.config();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  const results = {
    Authentication: false,
    Firestore: false,
    Storage: false,
    Clients: false,
    Products: false,
    Orders: false,
    'Daily Bills': false,
    Payments: false,
    Trash: false,
    Regions: false,
    Pricing: false,
  };

  try {
    console.log("Testing Authentication...");
    try {
      const testEmail = `test_${Date.now()}@example.com`;
      const testPass = 'password123';
      const userCred = await createUserWithEmailAndPassword(auth, testEmail, testPass);
      if (userCred.user) {
        results.Authentication = true;
        console.log("✅ Authentication successful");
      }
    } catch (authErr) {
      console.error("❌ Authentication error:", authErr.message);
    }

    console.log("Testing Firestore CRUD and creating collections...");
    const testDocId = `test_doc_${Date.now()}`;
    const collectionsToTest = [
      { key: 'Clients', name: 'clients' },
      { key: 'Products', name: 'products' },
      { key: 'Orders', name: 'orders' },
      { key: 'Daily Bills', name: 'bills' }, // They use 'payments' or 'bills'? Let's test both
      { key: 'Payments', name: 'payments' },
      { key: 'Trash', name: 'trash' },
      { key: 'Regions', name: 'regions' },
      { key: 'Pricing', name: 'pricing' },
      { key: 'users', name: 'users' }, // implicitly part of auth/firestore
    ];

    results.Firestore = true;

    for (const coll of collectionsToTest) {
      try {
        const docRef = doc(db, coll.name, testDocId);
        // Write
        await setDoc(docRef, { test: true, createdAt: new Date().toISOString() });
        // Read
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
          if (coll.key in results) results[coll.key] = true;
        } else {
          results.Firestore = false;
        }
        
        // Test onSnapshot briefly
        let snapshotReceived = false;
        const unsubscribe = onSnapshot(doc(db, coll.name, testDocId), (doc) => {
          if (doc.exists()) snapshotReceived = true;
        });
        
        await setDoc(docRef, { test: true, updated: true }, { merge: true });
        await delay(500); // wait for snapshot
        unsubscribe();

        // Delete
        await deleteDoc(docRef);
        console.log(`✅ Collection '${coll.name}' initialized and verified.`);
      } catch (err) {
        console.error(`❌ Error in collection '${coll.name}':`, err.message);
        results.Firestore = false;
      }
    }

    console.log("Testing Storage...");
    try {
      const storageRef = ref(storage, `test/${testDocId}.txt`);
      await uploadString(storageRef, 'hello world');
      await deleteObject(storageRef);
      results.Storage = true;
      console.log("✅ Storage verified.");
    } catch (err) {
      console.error("❌ Storage error:", err.message);
      results.Storage = false;
    }

    // Cleanup auth
    if (auth.currentUser) {
      await deleteUser(auth.currentUser);
    }

  } catch (error) {
    console.error("Critical Test Error:", error.message);
  }

  console.log("\n--- Verification Checklist ---");
  for (const [key, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${key}`);
  }
  process.exit(0);
}

runTests();
