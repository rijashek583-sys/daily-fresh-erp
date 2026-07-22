import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ",
  authDomain: "daily-fresh-billing-system.firebaseapp.com",
  projectId: "daily-fresh-billing-system",
  storageBucket: "daily-fresh-billing-system.firebasestorage.app",
  messagingSenderId: "83442679531",
  appId: "1:83442679531:web:cf8bc171e6419c0b0f48ae",
  measurementId: "G-2XDKC9R78P"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const regions = [
  { id: 'REG-1', name: 'Mangaluru North' },
  { id: 'REG-2', name: 'Mangaluru South' },
  { id: 'REG-3', name: 'Udupi Central' },
  { id: 'REG-4', name: 'Manipal' }
];

const products = [
  { id: 'PROD-1', name: 'Kuboos', category: 'Breads', unit: 'Pack' },
  { id: 'PROD-2', name: 'Rumali Roti', category: 'Breads', unit: 'Pack' },
  { id: 'PROD-3', name: 'Whole Wheat Bread', category: 'Breads', unit: 'Loaf' },
  { id: 'PROD-4', name: 'Burger Buns', category: 'Breads', unit: 'Pack' },
  { id: 'PROD-5', name: 'Plum Cake', category: 'Cakes', unit: 'Kg' },
  { id: 'PROD-6', name: 'Black Forest Pastry', category: 'Cakes', unit: 'Piece' },
  { id: 'PROD-7', name: 'Chicken Puff', category: 'Snacks', unit: 'Piece' },
  { id: 'PROD-8', name: 'Veg Samosa', category: 'Snacks', unit: 'Piece' },
  { id: 'PROD-9', name: 'Butter Cookies', category: 'Cookies', unit: 'Kg' },
  { id: 'PROD-10', name: 'Chocolate Muffin', category: 'Cakes', unit: 'Piece' }
];

const bakeries = [
  "Royal Bakery", "City Bakers", "Ideal Cafe", "Sunrise Bakery", "Golden Crust",
  "Oven Fresh", "The Cake Shop", "Daily Treats", "Sweet Delights", "Morning Star",
  "Fresh Bites", "Pioneer Bakers", "Elite Patisserie", "Classic Confectionery", "Tasty Bakes",
  "Crown Bakery", "Heritage Cafe", "Prime Bakers", "Urban Breads", "Supreme Bakery"
];

const generatePrice = (base) => {
  // Generate a realistic variation of the base price
  const variation = (Math.random() * 2 - 1); // -1 to +1
  return parseFloat((base + variation).toFixed(2));
};

const basePricesMap = {
  'PROD-1': 15,
  'PROD-2': 25,
  'PROD-3': 40,
  'PROD-4': 30,
  'PROD-5': 450,
  'PROD-6': 60,
  'PROD-7': 20,
  'PROD-8': 15,
  'PROD-9': 200,
  'PROD-10': 35
};

async function seed() {
  console.log('Clearing existing data...');
  const batch1 = writeBatch(db);
  const clientsSnap = await getDocs(collection(db, 'clients'));
  clientsSnap.forEach(d => batch1.delete(d.ref));
  const productsSnap = await getDocs(collection(db, 'products'));
  productsSnap.forEach(d => batch1.delete(d.ref));
  const regionsSnap = await getDocs(collection(db, 'config'));
  regionsSnap.forEach(d => batch1.delete(d.ref));
  
  await batch1.commit();
  console.log('Cleared existing data.');

  console.log('Seeding Regions...');
  const regionNames = regions.map(r => r.name);
  await setDoc(doc(db, 'config', 'regions'), { list: regionNames });

  console.log('Seeding Products...');
  const batch2 = writeBatch(db);
  for (const p of products) {
    batch2.set(doc(collection(db, 'products'), p.id), {
      name: p.name,
      category: p.category,
      unit: p.unit,
      status: 'active',
      stock: 100,
      description: `Fresh ${p.name} delivered daily.`
    });
  }
  await batch2.commit();

  console.log('Seeding Clients and Pricing...');
  const batch3 = writeBatch(db);
  for (let i = 0; i < 20; i++) {
    const region = regions[Math.floor(i / 5)].name;
    const clientId = `CLI-${1000 + i}`;
    
    // Create Client
    batch3.set(doc(collection(db, 'clients'), clientId), {
      name: bakeries[i],
      phone: `98${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
      email: `${bakeries[i].replace(/\s+/g, '').toLowerCase()}@example.com`,
      city: region.split(' ')[0],
      region: region,
      status: 'active',
      joinedAt: new Date().toISOString()
    });

    // Create Pricing
    const pricing = {};
    for (const p of products) {
      pricing[p.id] = generatePrice(basePricesMap[p.id]);
    }
    
    batch3.set(doc(collection(db, 'clientPricing'), clientId), { pricing });
  }
  
  await batch3.commit();
  console.log('Seed complete!');
  process.exit(0);
}

seed().catch(console.error);
