const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, deleteDoc, query, where } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

const validNames = [
  'BAKUR', 'B. GOLDEN', 'MALABAR PAIVALLIKE', 'ABADI CHEVAR', 'UK SHAWARMA',
  'IDEAL CHERKALA', 'KONCH', 'METRO', 'ROYAL DYNE', 'DARBAR', 'IKKAS',
  'NEW BADRIYA', 'KENZA', 'CHAYKADA', 'CHAPATHI', 'GULF KUZHIMANTHI',
  'LQ BIRIYANI', 'TEA TIME', 'FOOD NEWS', 'ARABIAN KUMBALA', 'MM KUMBALA',
  'ITALIAN', 'RAHMANIYA MOGRAL', 'CHOTTU MOGRAL', 'HINDUSTAN', 'SHAWYA HUB',
  'TAKASHI', 'ULIYATHADUKKA MEXICO', 'UK FOODLAND', 'CHIK ZONE',
  'BEA BIYA (ROYAL)', 'HIGHLAND UK', 'INDIKICHEN', 'GOLDEN NAYIMAR',
  'CHARCOLE', 'TAMAKI NAYIMAR', 'CHIKKING', 'HOT POT 4TH MAIL', 'FIDA FOOD',
  'SPAICY EXPRESS', 'TAMAKI KASRGODE', 'CALICUT', 'THALANKARA', 'FOODHUT',
  'CHOORI( TAKE AWY)', 'MS KASARGODE', 'MOMS', 'HAMSAKKA', 'KABABIA KASARGODE',
  'AL BAIN', 'GRILL PALACE (UK)', 'TESTINE( ARIAL MEXICO)', 'CHAYAKADI CHERKALA',
  'MULLLERIA FOODLAND', 'GOLDEN MELPRAMB', 'SMOCKEY PARK', 'MADGHOOT', 'COCOBEAN'
].map(n => n.toUpperCase());

async function run() {
  const q = query(collection(db, 'clients'), where('region', '==', 'Kasargode'));
  const snap = await getDocs(q);
  
  let deleted = 0;
  for (const d of snap.docs) {
    const name = d.data().name.toUpperCase();
    if (!validNames.includes(name)) {
      console.log(`Deleting invalid client: ${name}`);
      await deleteDoc(d.ref);
      await deleteDoc(doc(db, 'clientPricing', d.id)); // delete pricing too
      deleted++;
    }
  }

  // Print final result
  const finalSnap = await getDocs(query(collection(db, 'clients'), where('region', '==', 'Kasargode')));
  const finalList = [];
  finalSnap.forEach(d => finalList.push(d.data().name));
  finalList.sort();

  console.log(`\nKasargode Total Clients = ${finalList.length}\n`);
  finalList.forEach(name => console.log(name));

  console.log(`\nDeleted ${deleted} duplicates/invalid clients.`);
  process.exit(0);
}

run().catch(console.error);
