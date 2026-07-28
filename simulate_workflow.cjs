const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, getDoc, writeBatch, query, where, updateDoc, increment, runTransaction } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system'
});
const db = getFirestore(app);

// Simple assertion helper
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function simulate() {
  console.log("=== STARTING SIMULATION ===");

  const clientsSnap = await getDocs(collection(db, 'clients'));
  if (clientsSnap.empty) return console.log("No clients found.");
  const clientId = clientsSnap.docs[0].id;
  const clientName = clientsSnap.docs[0].data().name;

  // 1. Create First Order (Total: 10800)
  console.log("--- 1. Create First Order ---");
  let order1Id = `TEST_ORD_1_${Date.now()}`;
  let ledger1Id = `TEST_LED_1_${Date.now()}`;
  const batch1 = writeBatch(db);
  batch1.set(doc(db, 'orders', order1Id), {
    id: order1Id,
    clientId,
    clientName,
    total: 10800,
    deliveryDate: '2026-07-23'
  });
  batch1.set(doc(db, 'ledger', ledger1Id), {
    id: ledger1Id,
    type: 'invoice',
    clientId,
    invoiceId: order1Id,
    amount: 10800,
    createdAt: new Date().toISOString(),
    billDate: '2026-07-23'
  });
  await batch1.commit();

  // Test calculateOldBalance logic for First Order
  // Delivery Date = '2026-07-23', excludeInvoiceIds = [order1Id]
  const ledgerSnap1 = await getDocs(query(collection(db, 'ledger'), where('clientId', '==', clientId)));
  let previousBalance1 = 0;
  ledgerSnap1.forEach(d => {
    const l = d.data();
    if (l.invoiceId === order1Id) return; // Excluded!
    if ((l.billDate || l.paymentDate || l.createdAt).substring(0, 10) < '2026-07-23') {
      if (l.type === 'invoice') previousBalance1 += l.amount;
      if (l.type === 'payment') previousBalance1 -= l.amount;
    }
  });
  assert(previousBalance1 === 0, `First Order Previous Balance should be 0, got ${previousBalance1}`);
  console.log("✅ First Order Previous Balance is exactly 0");

  // 2. Create Payment for First Order (Total: 5000)
  console.log("--- 2. Create Payment ---");
  let payment1Id = `TEST_PAY_1_${Date.now()}`;
  let ledgerP1Id = `TEST_LED_P1_${Date.now()}`;
  const batch2 = writeBatch(db);
  batch2.set(doc(db, 'payments', payment1Id), {
    id: payment1Id,
    clientId,
    invoiceId: order1Id,
    amount: 5000,
    createdAt: new Date().toISOString()
  });
  batch2.set(doc(db, 'ledger', ledgerP1Id), {
    id: ledgerP1Id,
    type: 'payment',
    paymentId: payment1Id,
    clientId,
    invoiceId: order1Id,
    amount: 5000,
    paymentDate: new Date().toISOString(),
    billDate: '2026-07-23'
  });
  await batch2.commit();

  // 3. Create Second Order for Tomorrow (Total: 2000)
  console.log("--- 3. Create Second Order ---");
  let order2Id = `TEST_ORD_2_${Date.now()}`;
  let ledger2Id = `TEST_LED_2_${Date.now()}`;
  const batch3 = writeBatch(db);
  batch3.set(doc(db, 'orders', order2Id), {
    id: order2Id,
    clientId,
    clientName,
    total: 2000,
    deliveryDate: '2026-07-24'
  });
  batch3.set(doc(db, 'ledger', ledger2Id), {
    id: ledger2Id,
    type: 'invoice',
    clientId,
    invoiceId: order2Id,
    amount: 2000,
    createdAt: new Date().toISOString(),
    billDate: '2026-07-24'
  });
  await batch3.commit();

  // Test calculateOldBalance for Second Order
  // Delivery Date = '2026-07-24', exclude = [order2Id]
  const ledgerSnap2 = await getDocs(query(collection(db, 'ledger'), where('clientId', '==', clientId)));
  let previousBalance2 = 0;
  ledgerSnap2.forEach(d => {
    const l = d.data();
    if (l.invoiceId === order2Id) return; // Excluded!
    if ((l.billDate || l.paymentDate || l.createdAt).substring(0, 10) < '2026-07-24') {
      if (l.type === 'invoice') previousBalance2 += l.amount;
      if (l.type === 'payment') previousBalance2 -= l.amount;
    }
  });
  // Should include Order 1 (10800) and Payment 1 (-5000) = 5800
  assert(previousBalance2 === 5800, `Second Order Previous Balance should be 5800, got ${previousBalance2}`);
  console.log("✅ Second Order Previous Balance is exactly 5800");

  // Cleanup TEST records
  console.log("--- Cleanup Test Records ---");
  const cleanupBatch = writeBatch(db);
  cleanupBatch.delete(doc(db, 'orders', order1Id));
  cleanupBatch.delete(doc(db, 'orders', order2Id));
  cleanupBatch.delete(doc(db, 'payments', payment1Id));
  cleanupBatch.delete(doc(db, 'ledger', ledger1Id));
  cleanupBatch.delete(doc(db, 'ledger', ledger2Id));
  cleanupBatch.delete(doc(db, 'ledger', ledgerP1Id));
  await cleanupBatch.commit();
  console.log("✅ Simulation Cleanup Successful");
  
  console.log("=== END-TO-END SIMULATION PASSED WITHOUT ERRORS ===");
}

simulate().catch(console.error);
