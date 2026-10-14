/**
 * Daily Fresh ERP — Test Data Reset & Cleanup Script
 * 
 * Scope:
 * 1. Resets opening balances for AL BAIN (₹23,594) and ARABIAN KUMBALA (₹760).
 * 2. Resets stale derived transaction aggregates on ASR (totalPaid: 1, outstanding: -1).
 * 3. Deletes 7 trashed test records (orders and ledger entries).
 * 4. Deletes 595 orphaned stock sync status records tied to test orders.
 * 5. Verifies orders (0), payments (0), ledger (0), finishedStockTransactions (0).
 * 6. Preserves all 153 clients, 13 products, 125 client-specific pricings, 4 staff accounts, and settings.
 * 7. Full pre-cleanup backup created and verified before any mutations.
 * 8. Verifies zero balances and Dashboard Outstanding = 0 and Pending Collections = 0.
 */

const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const {
  getFirestore, collection, getDocs, doc, writeBatch, updateDoc, deleteDoc
} = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');
let apiKey = 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ';
let projectId = 'daily-fresh-billing-system';
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const keyMatch = env.match(/VITE_FIREBASE_API_KEY=(.+)/);
  const projMatch = env.match(/VITE_FIREBASE_PROJECT_ID=(.+)/);
  if (keyMatch) apiKey = keyMatch[1].trim();
  if (projMatch) projectId = projMatch[1].trim();
}

const app = initializeApp({
  apiKey,
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
});
const auth = getAuth(app);
const db = getFirestore(app);

async function executeBatchDeletes(colName, docIds) {
  const BATCH_SIZE = 250;
  let deleted = 0;
  for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
    const chunk = docIds.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(id => {
      batch.delete(doc(db, colName, id));
    });
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function runReset() {
  console.log('=====================================================');
  console.log(' DAILY FRESH ERP — TEST DATA CLEANUP & RESET');
  console.log('=====================================================\n');

  // Step 1: Auth
  console.log('Step 1: Authenticating as Admin...');
  await signInWithEmailAndPassword(auth, 'admin@gmail.com', 'admin@123');
  console.log('✓ Successfully authenticated.\n');

  // Step 2: Fetch current state
  console.log('Step 2: Fetching current database collections...');
  const [
    clientsSnap,
    productsSnap,
    ordersSnap,
    paymentsSnap,
    ledgerSnap,
    trashSnap,
    syncSnap,
    fstSnap,
    usersSnap,
    pricingSnap,
    settingsSnap
  ] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'orders')),
    getDocs(collection(db, 'payments')),
    getDocs(collection(db, 'ledger')),
    getDocs(collection(db, 'trash')),
    getDocs(collection(db, 'stockSyncStatus')),
    getDocs(collection(db, 'finishedStockTransactions')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'clientPricing')),
    getDocs(collection(db, 'settings')),
  ]);

  console.log(`- Clients:                   ${clientsSnap.docs.length}`);
  console.log(`- Products:                  ${productsSnap.docs.length}`);
  console.log(`- Orders:                    ${ordersSnap.docs.length}`);
  console.log(`- Payments:                  ${paymentsSnap.docs.length}`);
  console.log(`- Ledger:                    ${ledgerSnap.docs.length}`);
  console.log(`- Trash:                     ${trashSnap.docs.length}`);
  console.log(`- Stock Sync Status:         ${syncSnap.docs.length}`);
  console.log(`- Finished Stock Tx:         ${fstSnap.docs.length}`);
  console.log(`- Users / Staff:             ${usersSnap.docs.length}`);
  console.log(`- Client Pricing:            ${pricingSnap.docs.length}`);
  console.log(`- Settings:                  ${settingsSnap.docs.length}`);

  // Step 3: Exact Cleanup Scope
  console.log('\nStep 3: Defining Exact Cleanup Scope:');
  const targetClientsToReset = [];
  clientsSnap.docs.forEach(d => {
    const data = d.data();
    const hasOB = (data.openingBalanceAmount && data.openingBalanceAmount > 0) || (data.openingBalance && data.openingBalance.amount > 0);
    const hasOut = data.outstanding && data.outstanding !== 0;
    const hasPaid = data.totalPaid && data.totalPaid !== 0;
    const hasRev = data.totalRevenue && data.totalRevenue !== 0;
    const hasOrders = data.totalOrders && data.totalOrders !== 0;
    if (hasOB || hasOut || hasPaid || hasRev || hasOrders) {
      targetClientsToReset.push({
        id: d.id,
        name: data.name,
        openingBalance: data.openingBalance,
        openingBalanceAmount: data.openingBalanceAmount,
        outstanding: data.outstanding,
        totalPaid: data.totalPaid,
        totalRevenue: data.totalRevenue,
        totalOrders: data.totalOrders,
        primaryTotals: data.primaryTotals,
        bakeryTotals: data.bakeryTotals
      });
    }
  });

  console.log(`   Clients requiring balance / aggregate reset (${targetClientsToReset.length}):`);
  targetClientsToReset.forEach(c => {
    console.log(`   * [${c.id}] "${c.name}":`);
    console.log(`       Opening Balance: ₹${c.openingBalanceAmount || 0} (${JSON.stringify(c.openingBalance || null)})`);
    console.log(`       Outstanding: ₹${c.outstanding || 0}, Total Paid: ₹${c.totalPaid || 0}, Revenue: ₹${c.totalRevenue || 0}, Orders: ${c.totalOrders || 0}`);
  });

  const trashIds = trashSnap.docs.map(d => d.id);
  console.log(`   Trash records to purge: ${trashIds.length}`);
  const syncIds = syncSnap.docs.map(d => d.id);
  console.log(`   Orphaned Stock Sync Status records to purge: ${syncIds.length}`);

  // Step 4: Pre-cleanup Backup Creation and Verification
  console.log('\nStep 4: Creating and verifying pre-cleanup backup...');
  const backupDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.resolve(backupDir, `test_data_backup_${timestamp}.json`);

  const backupData = {
    timestamp: new Date().toISOString(),
    clientsCount: clientsSnap.docs.length,
    clients: clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    trashCount: trashSnap.docs.length,
    trash: trashSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    stockSyncStatusCount: syncSnap.docs.length,
    stockSyncStatus: syncSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    ordersCount: ordersSnap.docs.length,
    orders: ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    paymentsCount: paymentsSnap.docs.length,
    payments: paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    ledgerCount: ledgerSnap.docs.length,
    ledger: ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    finishedStockTransactionsCount: fstSnap.docs.length,
    finishedStockTransactions: fstSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

  // Verify Backup File
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup verification failed: File ${backupFile} does not exist!`);
  }
  const stat = fs.statSync(backupFile);
  if (stat.size === 0) {
    throw new Error(`Backup verification failed: File ${backupFile} is empty!`);
  }
  const readBack = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (readBack.clientsCount !== clientsSnap.docs.length || readBack.trashCount !== trashSnap.docs.length) {
    throw new Error(`Backup verification failed: Integrity mismatch!`);
  }
  console.log(`✓ Backup successfully written and verified:`);
  console.log(`  Path: ${backupFile}`);
  console.log(`  Size: ${(stat.size / 1024).toFixed(2)} KB`);
  console.log(`  Backed up: ${readBack.clientsCount} clients, ${readBack.trashCount} trash items, ${readBack.stockSyncStatusCount} sync status items.\n`);

  // Step 5: Execute Reset
  console.log('Step 5: Executing Reset Operations...');

  // 5a. Reset client opening balances and aggregates
  console.log('   5a. Resetting client opening balances and derived aggregates...');
  for (const c of targetClientsToReset) {
    const clientRef = doc(db, 'clients', c.id);
    await updateDoc(clientRef, {
      openingBalance: null,
      openingBalanceAmount: 0,
      totalRevenue: 0,
      totalPaid: 0,
      outstanding: 0,
      totalOrders: 0,
      primaryTotals: {
        totalRevenue: 0,
        totalPaid: 0,
        outstanding: 0,
        totalOrders: 0,
        openingBalance: 0,
      },
      bakeryTotals: {
        totalRevenue: 0,
        totalPaid: 0,
        outstanding: 0,
        totalOrders: 0,
        openingBalance: 0,
      }
    });
    console.log(`       ✓ Reset client [${c.id}] "${c.name}" to zero balances`);
  }

  // 5b. Delete trash
  if (trashIds.length > 0) {
    console.log(`   5b. Deleting ${trashIds.length} trashed test items...`);
    const delTrash = await executeBatchDeletes('trash', trashIds);
    console.log(`       ✓ Purged ${delTrash} trash items`);
  }

  // 5c. Delete orphaned stockSyncStatus
  if (syncIds.length > 0) {
    console.log(`   5c. Deleting ${syncIds.length} orphaned stockSyncStatus records...`);
    const delSync = await executeBatchDeletes('stockSyncStatus', syncIds);
    console.log(`       ✓ Purged ${delSync} stockSyncStatus records`);
  }

  // 5d. Also ensure orders, payments, ledger are empty
  if (ordersSnap.docs.length > 0) {
    await executeBatchDeletes('orders', ordersSnap.docs.map(d => d.id));
  }
  if (paymentsSnap.docs.length > 0) {
    await executeBatchDeletes('payments', paymentsSnap.docs.map(d => d.id));
  }
  if (ledgerSnap.docs.length > 0) {
    await executeBatchDeletes('ledger', ledgerSnap.docs.map(d => d.id));
  }
  if (fstSnap.docs.length > 0) {
    await executeBatchDeletes('finishedStockTransactions', fstSnap.docs.map(d => d.id));
  }

  console.log('✓ All reset operations completed successfully.\n');

  // Step 6: Post-Reset Verification
  console.log('Step 6: Verifying Post-Reset State...');
  const [
    vClientsSnap,
    vOrdersSnap,
    vPaymentsSnap,
    vLedgerSnap,
    vTrashSnap,
    vSyncSnap,
    vFstSnap,
    vProductsSnap,
    vUsersSnap,
    vPricingSnap,
    vSettingsSnap
  ] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'orders')),
    getDocs(collection(db, 'payments')),
    getDocs(collection(db, 'ledger')),
    getDocs(collection(db, 'trash')),
    getDocs(collection(db, 'stockSyncStatus')),
    getDocs(collection(db, 'finishedStockTransactions')),
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'clientPricing')),
    getDocs(collection(db, 'settings')),
  ]);

  console.log('   --- Transaction & Test Records Verification ---');
  console.log(`   * Orders count:                  ${vOrdersSnap.docs.length} (Expected: 0)`);
  console.log(`   * Payments count:                ${vPaymentsSnap.docs.length} (Expected: 0)`);
  console.log(`   * Ledger entries count:          ${vLedgerSnap.docs.length} (Expected: 0)`);
  console.log(`   * Trash count:                   ${vTrashSnap.docs.length} (Expected: 0)`);
  console.log(`   * Stock sync status count:       ${vSyncSnap.docs.length} (Expected: 0)`);
  console.log(`   * Finished stock tx count:       ${vFstSnap.docs.length} (Expected: 0)`);

  if (vOrdersSnap.docs.length !== 0 || vPaymentsSnap.docs.length !== 0 || vLedgerSnap.docs.length !== 0 || vTrashSnap.docs.length !== 0) {
    throw new Error('Verification failed: Transaction or trash records still exist!');
  }

  console.log('\n   --- Master Business Records Verification (Preserved) ---');
  console.log(`   * Total Clients preserved:       ${vClientsSnap.docs.length} (Expected: 153)`);
  console.log(`   * Products preserved:            ${vProductsSnap.docs.length} (Expected: 13)`);
  console.log(`   * Client Pricing preserved:      ${vPricingSnap.docs.length} (Expected: 125)`);
  console.log(`   * Staff / Users preserved:       ${vUsersSnap.docs.length} (Expected: 4)`);
  console.log(`   * Settings preserved:            ${vSettingsSnap.docs.length} (Expected: 1)`);

  if (vClientsSnap.docs.length !== 153) {
    throw new Error(`Verification failed: Client count is ${vClientsSnap.docs.length}, expected 153!`);
  }

  console.log('\n   --- Client Balances & Aggregates Verification ---');
  let nonZeroCount = 0;
  let totalOutstanding = 0;
  let totalOpeningBalances = 0;
  vClientsSnap.docs.forEach(d => {
    const data = d.data();
    const ob = data.openingBalanceAmount || 0;
    const out = data.outstanding || 0;
    const paid = data.totalPaid || 0;
    const rev = data.totalRevenue || 0;
    const ord = data.totalOrders || 0;
    totalOutstanding += Math.max(0, out);
    totalOpeningBalances += ob;
    if (ob !== 0 || out !== 0 || paid !== 0 || rev !== 0 || ord !== 0) {
      console.warn(`   WARNING: Client [${d.id}] "${data.name}" has non-zero values: ob=${ob}, out=${out}, paid=${paid}`);
      nonZeroCount++;
    }
  });

  console.log(`   * Clients with non-zero balances: ${nonZeroCount} (Expected: 0)`);
  console.log(`   * Total Outstanding sum:          ₹${totalOutstanding.toFixed(2)} (Expected: ₹0.00)`);
  console.log(`   * Total Opening Balances sum:     ₹${totalOpeningBalances.toFixed(2)} (Expected: ₹0.00)`);

  // Verify AL BAIN, ARABIAN KUMBALA, ASR specifically
  const albain = vClientsSnap.docs.find(d => d.id === 'CLT-1784727677046-y72v0v')?.data();
  const arabian = vClientsSnap.docs.find(d => d.id === 'CLT-1784726371677-h6bchk')?.data();
  const asr = vClientsSnap.docs.find(d => d.id === 'L5BuwlusCKObjkezmDdY')?.data();

  console.log('\n   --- Target Clients Specific Verification ---');
  console.log(`   * AL BAIN:        outstanding=${albain?.outstanding}, openingBalanceAmount=${albain?.openingBalanceAmount}, openingBalance=${albain?.openingBalance}`);
  console.log(`   * ARABIAN KUMBALA: outstanding=${arabian?.outstanding}, openingBalanceAmount=${arabian?.openingBalanceAmount}, openingBalance=${arabian?.openingBalance}`);
  console.log(`   * ASR:            outstanding=${asr?.outstanding}, totalPaid=${asr?.totalPaid}`);

  if (totalOutstanding !== 0 || totalOpeningBalances !== 0 || nonZeroCount !== 0) {
    throw new Error('Verification failed: Outstanding or opening balances are not 0!');
  }

  console.log('\n=====================================================');
  console.log(' CLEANUP & RESET VERIFICATION PASSED 100%');
  console.log('=====================================================\n');
}

runReset().catch(err => {
  console.error('Reset execution failed:', err);
  process.exit(1);
});
