const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, query, where } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

const KASARGODE_CLIENTS = [
  { name: 'BAKUR', kuboos: 18, rumali: 10 },
  { name: 'B. GOLDEN', kuboos: 19, rumali: 10 },
  { name: 'MALABAR PAIVALLIKE', kuboos: 19 },
  { name: 'ABADI CHEVAR', kuboos: 19, rumali: 10 },
  { name: 'UK SHAWARMA' },
  { name: 'IDEAL CHERKALA', kuboos: 18, rumali: 9 },
  { name: 'KONCH' },
  { name: 'METRO', kuboos: 19, rumali: 10 },
  { name: 'ROYAL DYNE', kuboos: 18, rumali: 10 },
  { name: 'DARBAR', kuboos: 17 },
  { name: 'IKKAS', kuboos: 19 },
  { name: 'NEW BADRIYA', kuboos: 19 },
  { name: 'KENZA', kuboos: 19 },
  { name: 'CHAYKADA' },
  { name: 'CHAPATHI', kuboos: 3.4 },
  { name: 'GULF KUZHIMANTHI', kuboos: 18 },
  { name: 'LQ BIRIYANI', kuboos: 18, rumali: 8.5 },
  { name: 'TEA TIME', kuboos: 19, rumali: 10 },
  { name: 'FOOD NEWS' },
  { name: 'ARABIAN KUMBALA', kuboos: 19 },
  { name: 'MM KUMBALA', kuboos: 19, rumali: 9 },
  { name: 'ITALIAN', kuboos: 19, rumali: 10 },
  { name: 'RAHMANIYA MOGRAL', kuboos: 19, rumali: 9 },
  { name: 'CHOTTU MOGRAL', kuboos: 17.5 },
  { name: 'HINDUSTAN', kuboos: 19 },
  { name: 'SHAWYA HUB' },
  { name: 'TAKASHI', kuboos: 19, rumali: 10 },
  { name: 'ULIYATHADUKKA MEXICO', rumali: 9 },
  { name: 'UK FOODLAND', kuboos: 19, rumali: 10 },
  { name: 'CHIK ZONE', kuboos: 18 },
  { name: 'BEA BIYA (ROYAL)', kuboos: 19, rumali: 10 },
  { name: 'HIGHLAND UK' },
  { name: 'INDIKICHEN', kuboos: 19 },
  { name: 'GOLDEN NAYIMAR', kuboos: 17 },
  { name: 'CHARCOLE', kuboos: 19 },
  { name: 'TAMAKI NAYIMAR' },
  { name: 'CHIKKING', soft: 24 },
  { name: 'HOT POT 4TH MAIL', kuboos: 19 },
  { name: 'FIDA FOOD' },
  { name: 'SPAICY EXPRESS', rumali: 10, bun: 21 },
  { name: 'TAMAKI KASRGODE', kuboos: 19 },
  { name: 'CALICUT', kuboos: 17, rumali: 9 },
  { name: 'THALANKARA' },
  { name: 'FOODHUT' },
  { name: 'CHOORI( TAKE AWY)', kuboos: 18 },
  { name: 'MS KASARGODE', rumali: 9 },
  { name: 'MOMS', rumali: 10 },
  { name: 'HAMSAKKA', kuboos: 19 },
  { name: 'KABABIA KASARGODE', kuboos: 18, rumali: 8 },
  { name: 'AL BAIN', kuboos: 19, rumali: 10, bun: 22 },
  { name: 'GRILL PALACE (UK)', kuboos: 19, rumali: 9 },
  { name: 'TESTINE( ARIAL MEXICO)', kuboos: 19, rumali: 10, bun: 21 },
  { name: 'CHAYAKADI CHERKALA', kuboos: 19, rumali: 20 },
  { name: 'MULLLERIA FOODLAND', kuboos: 19 },
  { name: 'GOLDEN MELPRAMB', kuboos: 17, rumali: 10, bun: 20 },
  { name: 'SMOCKEY PARK' },
  { name: 'MADGHOOT' },
  { name: 'COCOBEAN' }
];

const PROD_KUBOOS = 'PROD-1';
const PROD_RUMALI = 'PROD-2';
const PROD_BUN = 'PROD-4';
const PROD_SOFT = 'PROD-SOFT';

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

async function run() {
  console.log('Fetching existing Kasargode clients...');
  
  // Ensure SOFT product exists just in case it doesn't
  await setDoc(doc(db, 'products', PROD_SOFT), {
    name: 'Soft',
    category: 'Bakery',
    unit: 'Pack',
    status: 'active',
    stock: 0,
    description: 'Created for Kasargode import',
  }, { merge: true });

  const q = query(collection(db, 'clients'), where('region', '==', 'Kasargode'));
  const snap = await getDocs(q);
  const existingClients = {};
  snap.forEach(d => {
    existingClients[d.data().name.toUpperCase()] = d.data();
  });

  console.log(`Found ${Object.keys(existingClients).length} existing clients in Kasargode.`);
  let added = 0;
  let updated = 0;

  for (const clientDef of KASARGODE_CLIENTS) {
    const cname = clientDef.name.toUpperCase();
    let client = existingClients[cname];
    let clientId;

    if (!client) {
      // Create new client
      clientId = generateId('CLT');
      const now = new Date().toISOString();
      const newDoc = {
        id: clientId,
        name: cname,
        region: 'Kasargode',
        regionName: 'Kasargode',
        status: 'active',
        totalOrders: 0,
        totalRevenue: 0,
        outstanding: 0,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, 'clients', clientId), newDoc);
      added++;
    } else {
      clientId = client.id;
    }

    // Set pricing
    const pricing = {};
    if (clientDef.kuboos !== undefined) pricing[PROD_KUBOOS] = clientDef.kuboos;
    if (clientDef.rumali !== undefined) pricing[PROD_RUMALI] = clientDef.rumali;
    if (clientDef.bun !== undefined) pricing[PROD_BUN] = clientDef.bun;
    if (clientDef.soft !== undefined) pricing[PROD_SOFT] = clientDef.soft;

    if (Object.keys(pricing).length > 0) {
      await setDoc(doc(db, 'clientPricing', clientId), {
        clientId,
        pricing,
        updatedAt: new Date().toISOString(),
      });
      updated++;
    } else {
      // Clear pricing if there was any previously but shouldn't be
      await setDoc(doc(db, 'clientPricing', clientId), {
        clientId,
        pricing: {},
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Print final result
  const finalSnap = await getDocs(query(collection(db, 'clients'), where('region', '==', 'Kasargode')));
  const finalList = [];
  finalSnap.forEach(d => finalList.push(d.data().name));
  finalList.sort();

  console.log(`\nKasargode Total Clients = ${finalList.length}\n`);
  finalList.forEach(name => console.log(name));

  console.log(`\nAdded ${added} new clients, processed pricing for all 58.`);
  process.exit(0);
}

run().catch(console.error);
