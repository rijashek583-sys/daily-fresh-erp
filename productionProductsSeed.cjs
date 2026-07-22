const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, updateDoc } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

const NEW_PRODUCTS = [
  { id: 'PROD-1', name: 'Kuboos', displayOrder: 1 },
  { id: 'PROD-2', name: 'Roomali', displayOrder: 2 },
  { id: 'PROD-3', name: 'Soft Kuboos', displayOrder: 3 },
  { id: 'PROD-4', name: 'Burger Bun', displayOrder: 4 },
  { id: 'PROD-5', name: 'Broasted Bun', displayOrder: 5 },
  { id: 'PROD-6', name: 'Sandwich Bread', displayOrder: 6 },
  { id: 'PROD-7', name: 'Ringless Bun', displayOrder: 7 },
  { id: 'PROD-8', name: 'Frozen Bun', displayOrder: 8 },
  { id: 'PROD-9', name: 'Samooli', displayOrder: 9 },
  { id: 'PROD-10', name: 'Paav Big', displayOrder: 10 },
  { id: 'PROD-11', name: 'Paav Small', displayOrder: 11 },
  { id: 'PROD-12', name: 'Snack Bun', displayOrder: 12 },
];

const VALID_PRODUCT_IDS = NEW_PRODUCTS.map(p => p.id);

async function run() {
  console.log('Starting official product reset...');

  // 1. Delete all existing products
  const productsSnap = await getDocs(collection(db, 'products'));
  let deletedProducts = 0;
  for (const d of productsSnap.docs) {
    await deleteDoc(d.ref);
    deletedProducts++;
  }
  console.log(`Deleted ${deletedProducts} old products.`);

  // 2. Delete product entries from Trash
  const trashSnap = await getDocs(collection(db, 'trash'));
  let deletedTrash = 0;
  for (const d of trashSnap.docs) {
    if (d.data().type === 'product' || d.data().type === 'products') {
      await deleteDoc(d.ref);
      deletedTrash++;
    }
  }
  console.log(`Deleted ${deletedTrash} products from Trash.`);

  // 3. Create the 12 new official products
  const now = new Date().toISOString();
  for (const p of NEW_PRODUCTS) {
    await setDoc(doc(db, 'products', p.id), {
      id: p.id,
      name: p.name,
      status: 'active',
      displayOrder: p.displayOrder,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`Created ${NEW_PRODUCTS.length} official products.`);

  // 4. Update Client Pricing (migrate PROD-SOFT -> PROD-3, delete invalid)
  const pricingSnap = await getDocs(collection(db, 'clientPricing'));
  let updatedPricing = 0;
  for (const d of pricingSnap.docs) {
    const data = d.data();
    if (!data.pricing) continue;
    
    let changed = false;
    const newPricing = {};
    
    for (const [pid, val] of Object.entries(data.pricing)) {
      // Migrate old soft kuboos ID to new PROD-3
      let mappedPid = pid;
      if (pid === 'PROD-SOFT') {
        mappedPid = 'PROD-3';
        changed = true;
      }
      
      if (VALID_PRODUCT_IDS.includes(mappedPid)) {
        newPricing[mappedPid] = val;
        if (pid !== mappedPid) changed = true;
      } else {
        changed = true; // Key was dropped
      }
    }
    
    if (changed) {
      if (Object.keys(newPricing).length === 0) {
        // If no pricing left, still save an empty object or delete? Saving empty object is fine to keep structure
        await updateDoc(d.ref, { pricing: {} });
      } else {
        await updateDoc(d.ref, { pricing: newPricing });
      }
      updatedPricing++;
    }
  }
  console.log(`Updated/cleaned ${updatedPricing} clientPricing records.`);

  // 5. Update Orders (remove invalid items)
  const ordersSnap = await getDocs(collection(db, 'orders'));
  let updatedOrders = 0;
  for (const d of ordersSnap.docs) {
    const order = d.data();
    if (order.items && Array.isArray(order.items)) {
      const newItems = [];
      let changed = false;
      
      for (const item of order.items) {
        let mappedPid = item.productId;
        if (mappedPid === 'PROD-SOFT') mappedPid = 'PROD-3';
        
        if (VALID_PRODUCT_IDS.includes(mappedPid)) {
          // Update productName just in case it changed
          const correctName = NEW_PRODUCTS.find(p => p.id === mappedPid).name;
          if (item.productId !== mappedPid || item.productName !== correctName) {
            item.productId = mappedPid;
            item.productName = correctName;
            changed = true;
          }
          newItems.push(item);
        } else {
          changed = true; // Drop item
        }
      }
      
      if (changed) {
        if (newItems.length === 0) {
          await deleteDoc(d.ref);
          console.log(`Deleted order ${d.id} because it had no valid items left.`);
        } else {
          const newTotal = newItems.reduce((acc, curr) => acc + curr.total, 0);
          await updateDoc(d.ref, { items: newItems, total: newTotal });
        }
        updatedOrders++;
      }
    }
  }
  console.log(`Updated/cleaned ${updatedOrders} orders.`);

  console.log('\nTotal Products = 12\n');
  console.log('Product Order:\n');
  NEW_PRODUCTS.forEach(p => {
    console.log(`${p.displayOrder}. ${p.name}`);
  });

  process.exit(0);
}

run().catch(console.error);
