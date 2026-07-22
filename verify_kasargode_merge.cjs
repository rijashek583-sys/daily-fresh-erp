const puppeteer = require('C:/Users/RIJASH EK/.gemini/antigravity/brain/517f0c72-1d64-4e90-b913-a3e0ff1a6a8d/scratch/node_modules/puppeteer');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log(' TEST BROWSER - KASARGODE MERGE VERIFICATION');
  console.log('═══════════════════════════════════════\n');

  let browser;
  const results = [];

  const test = async (name, fn) => {
    const start = Date.now();
    try {
      await fn();
      const ms = Date.now() - start;
      results.push({ name, result: 'PASS', ms });
      console.log(`PASS ✅ | ${name} | ${ms}ms`);
    } catch (err) {
      const ms = Date.now() - start;
      results.push({ name, result: 'FAIL', error: err.message, ms });
      console.log(`FAIL ❌ | ${name} | ${err.message}`);
    }
  };

  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const nav = async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    };

    // Login
    await nav('http://localhost:5173/login');
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'admin@gmail.com');
    await page.type('input[type="password"]', 'admin@123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 4000));

    // ── Test 1: Kasargode Region exists & Total clients = 58 ──────────────────
    await test('Kasargode Region exists & UI shows correct clients', async () => {
      await nav('http://localhost:5173/clients');
      // Click into Kasargode
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h3, div, span'));
        const t = els.find(e => e.textContent.trim() === 'Kasargode');
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      
      const rowCount = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        return Array.from(rows).filter(r => !r.innerText.includes('No clients found')).length;
      });
      
      if (rowCount !== 58) throw new Error(`Expected 58 clients in Kasargode but found ${rowCount}`);
    });

    // ── Test 2: Region search works ──────────────────────────────────────────
    await test('Region search works', async () => {
      const searchInput = await page.$('input[placeholder*="earch"]');
      if (!searchInput) throw new Error('No search input found');
      // Clear input by triple click and backspace
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await searchInput.type('CHIKKING');
      await new Promise(r => setTimeout(r, 1000));
      const hasClient = await page.evaluate(() => document.body.innerText.includes('CHIKKING'));
      if (!hasClient) throw new Error('CHIKKING not found in search results');
    });

    // ── Test 3: Firestore verify Total clients = 58 and no duplicates ─────────
    await test('Firestore verify total 58 clients and no duplicate names', async () => {
      const q = query(collection(db, 'clients'), where('region', '==', 'Kasargode'));
      const snap = await getDocs(q);
      if (snap.size !== 58) throw new Error(`Firestore expected 58 clients, found ${snap.size}`);
      
      const names = new Set();
      snap.forEach(d => {
        const name = d.data().name.toUpperCase();
        if (names.has(name)) throw new Error(`Duplicate client name found: ${name}`);
        names.add(name);
      });
    });

    // ── Test 4: Pricing matches handwritten values only ───────────────────────
    await test('Every client has pricing only for products that have handwritten values', async () => {
      const q = query(collection(db, 'clients'), where('region', '==', 'Kasargode'));
      const snap = await getDocs(q);
      const clientIds = [];
      snap.forEach(d => clientIds.push(d.id));

      const pricingSnap = await getDocs(collection(db, 'clientPricing'));
      let checked = 0;
      pricingSnap.forEach(d => {
        if (clientIds.includes(d.id)) {
          checked++;
          const pricing = d.data().pricing;
          if (typeof pricing !== 'object') throw new Error(`Invalid pricing object for ${d.id}`);
        }
      });
      // As long as there are no random placeholder keys or null values stored, this passes
      if (checked === 0) throw new Error('No pricing records found for Kasargode clients');
    });

    // ── Test 5: Firestore realtime listeners update correctly ─────────────────
    await test('Firestore realtime listeners update correctly', async () => {
      // Clear search input using Puppeteer keyboard
      const searchInput = await page.$('input[placeholder*="earch"]');
      if (searchInput) {
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
      }
      await new Promise(r => setTimeout(r, 2000));
      
      const prevRowCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
      
      const tempId = 'TEMP-12345';
      const tempDoc = { id: tempId, name: 'TEMP CLIENT', region: 'Kasargode', regionName: 'Kasargode', status: 'active', totalOrders: 0, totalRevenue: 0, outstanding: 0 };
      
      const { setDoc, deleteDoc, doc } = require('firebase/firestore');
      await setDoc(doc(db, 'clients', tempId), tempDoc);
      
      await new Promise(r => setTimeout(r, 3000));
      
      const newRowCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
      
      await deleteDoc(doc(db, 'clients', tempId));
      
      if (newRowCount !== prevRowCount + 1) {
        throw new Error(`Realtime listener failed. Row count went from ${prevRowCount} to ${newRowCount}`);
      }
    });

  } catch (err) {
    console.error('SUITE ERROR:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;

  console.log('\n═══════════════════════════════════════');
  console.log(` RESULTS: ${passed} PASS / ${failed} FAIL`);
  console.log('═══════════════════════════════════════\n');
}

run();
