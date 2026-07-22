const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc, writeBatch } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

async function clearCollection(colName) {
  const snapshot = await getDocs(collection(db, colName));
  const batch = writeBatch(db);
  let count = 0;
  snapshot.forEach(d => {
    batch.delete(d.ref);
    count++;
  });
  if (count > 0) {
    await batch.commit();
  }
  console.log(`Deleted ${count} documents from ${colName}`);
}

async function resetClients() {
  const snapshot = await getDocs(collection(db, 'clients'));
  const batch = writeBatch(db);
  let count = 0;
  snapshot.forEach(d => {
    batch.update(d.ref, {
      outstanding: 0,
      totalOrders: 0,
      totalRevenue: 0,
      lastPaymentDate: null,
      totalPaid: 0
    });
    count++;
  });
  if (count > 0) {
    await batch.commit();
  }
  console.log(`Reset metrics for ${count} clients`);
}

async function run() {
  console.log('Starting transactional data reset...');
  try {
    await clearCollection('orders');
    await clearCollection('payments');
    await clearCollection('dailyBills');
    await clearCollection('ledger');
    await clearCollection('reports');
    await clearCollection('trash');
    
    await resetClients();
    console.log('Reset complete!');
    process.exit(0);
  } catch(e) {
    console.error('Error during reset:', e);
    process.exit(1);
  }
}

run();
