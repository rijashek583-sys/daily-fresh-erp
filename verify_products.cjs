const puppeteer = require('C:/Users/RIJASH EK/.gemini/antigravity/brain/517f0c72-1d64-4e90-b913-a3e0ff1a6a8d/scratch/node_modules/puppeteer');
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log(' TEST BROWSER - PRODUCTS VERIFICATION');
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
      await new Promise(r => setTimeout(r, 2000));
    };

    // Login
    await nav('http://localhost:5173/login');
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'admin@gmail.com');
    await page.type('input[type="password"]', 'admin@123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3000));

    // ── Test 1: Product List & Product ordering ───────────────────────────────
    await test('Product List and Product ordering', async () => {
      await nav('http://localhost:5173/products');
      const products = await page.evaluate(() => {
        const rows = document.querySelectorAll('.max-w-5xl h3');
        return Array.from(rows).map(r => r.innerText.trim());
      });
      if (products.length !== 12) throw new Error(`Expected 12 products, got ${products.length}`);
      
      const expected = [
        'Kuboos', 'Roomali', 'Soft Kuboos', 'Burger Bun', 'Broasted Bun',
        'Sandwich Bread', 'Ringless Bun', 'Frozen Bun', 'Samooli', 
        'Paav Big', 'Paav Small', 'Snack Bun'
      ];
      
      for (let i = 0; i < expected.length; i++) {
        if (products[i] !== expected[i]) throw new Error(`Ordering mismatch at index ${i}. Expected ${expected[i]}, got ${products[i]}`);
      }
    });

    // ── Test 2: No Price field anywhere ───────────────────────────────────────
    await test('No Price field anywhere', async () => {
      await nav('http://localhost:5173/products');
      const listHasPrice = await page.evaluate(() => document.body.innerText.toLowerCase().includes('price'));
      if (listHasPrice) throw new Error('Found word "price" on Products List page');
      
      await nav('http://localhost:5173/products/new');
      const addHasPrice = await page.evaluate(() => document.body.innerText.toLowerCase().includes('price'));
      if (addHasPrice) throw new Error('Found word "price" on Add Product page');
    });

    // ── Test 3: Add Product ───────────────────────────────────────────────────
    let addedProductId = null;
    await test('Add Product', async () => {
      await nav('http://localhost:5173/products/new');
      await page.waitForSelector('input[placeholder*="Kuboos"]');
      await page.type('input[placeholder*="Kuboos"]', 'TEST_PRODUCT_NEW');
      
      // Select displayOrder
      const inputs = await page.$$('input[type="number"]');
      await inputs[0].type('12');
      
      // Save
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const save = btns.find(b => b.textContent.includes('Save Product'));
        if (save) save.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      
      const hasProduct = await page.evaluate(() => document.body.innerText.includes('TEST_PRODUCT_NEW'));
      if (!hasProduct) throw new Error('New product not found in list');
    });

    // ── Test 4: Edit Product ──────────────────────────────────────────────────
    await test('Edit Product', async () => {
      await nav('http://localhost:5173/products');
      // Find Edit button for TEST_PRODUCT_NEW
      await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.max-w-5xl .group'));
        const card = cards.find(c => c.innerText.includes('TEST_PRODUCT_NEW'));
        if (card) {
          const editBtn = card.querySelector('button[title="Edit Product"]');
          if (editBtn) editBtn.click();
        }
      });
      await new Promise(r => setTimeout(r, 2000));
      
      // Change name to TEST_PRODUCT_EDIT
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Kuboos"]');
        if (input) {
          input.value = ''; // clear
        }
      });
      await page.type('input[placeholder*="Kuboos"]', 'TEST_PRODUCT_EDIT');
      
      // Save
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const save = btns.find(b => b.textContent.includes('Update Product'));
        if (save) save.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      
      const hasProduct = await page.evaluate(() => document.body.innerText.includes('TEST_PRODUCT_EDIT'));
      if (!hasProduct) throw new Error('Edited product name not found in list');
    });

    // ── Test 5: Delete Product ────────────────────────────────────────────────
    await test('Delete Product', async () => {
      await nav('http://localhost:5173/products');
      // Override confirm
      await page.evaluate(() => { window.confirm = () => true; });
      
      // Click delete for TEST_PRODUCT_EDIT
      await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.max-w-5xl .group'));
        const card = cards.find(c => c.innerText.includes('TEST_PRODUCT_EDIT'));
        if (card) {
          const delBtn = card.querySelector('button[title="Delete Product"]');
          if (delBtn) delBtn.click();
        }
      });
      await new Promise(r => setTimeout(r, 3000));
      
      const hasProduct = await page.evaluate(() => document.body.innerText.includes('TEST_PRODUCT_EDIT'));
      if (hasProduct) throw new Error('Product is still in the list after deletion');
    });

    // ── Test 6: Restore Product ───────────────────────────────────────────────
    await test('Restore Product', async () => {
      await nav('http://localhost:5173/trash');
      await new Promise(r => setTimeout(r, 2000));
      
      const hasProduct = await page.evaluate(() => document.body.innerText.includes('TEST_PRODUCT_EDIT'));
      if (!hasProduct) throw new Error('Deleted product not found in Trash');
      
      // Restore
      await page.evaluate(() => { window.confirm = () => true; });
      await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        const row = rows.find(r => r.innerText.includes('TEST_PRODUCT_EDIT'));
        if (row) {
          const btns = Array.from(row.querySelectorAll('button'));
          const restore = btns.find(b => b.textContent.includes('Restore'));
          if (restore) restore.click();
        }
      });
      await new Promise(r => setTimeout(r, 3000));
      
      // Check it's back in products
      await nav('http://localhost:5173/products');
      const back = await page.evaluate(() => document.body.innerText.includes('TEST_PRODUCT_EDIT'));
      if (!back) throw new Error('Restored product not in product list');
    });

    // ── Test 7: Permanent Delete Product ──────────────────────────────────────
    await test('Permanent Delete Product', async () => {
      await nav('http://localhost:5173/products');
      // Delete it again
      await page.evaluate(() => { window.confirm = () => true; });
      await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.max-w-5xl .group'));
        const card = cards.find(c => c.innerText.includes('TEST_PRODUCT_EDIT'));
        if (card) {
          const delBtn = card.querySelector('button[title="Delete Product"]');
          if (delBtn) delBtn.click();
        }
      });
      await new Promise(r => setTimeout(r, 3000));
      
      // Go to trash
      await nav('http://localhost:5173/trash');
      await new Promise(r => setTimeout(r, 2000));
      
      // Permanent Delete
      await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        const row = rows.find(r => r.innerText.includes('TEST_PRODUCT_EDIT'));
        if (row) {
          const btns = Array.from(row.querySelectorAll('button'));
          const del = btns.find(b => b.textContent.includes('Delete Permanently'));
          if (del) del.click();
        }
      });
      await new Promise(r => setTimeout(r, 3000));
      
      const inTrash = await page.evaluate(() => document.body.innerText.includes('TEST_PRODUCT_EDIT'));
      if (inTrash) throw new Error('Product still in trash after permanent delete');
    });

    // ── Test 8: Client Pricing still works ────────────────────────────────────
    await test('Client Pricing still works', async () => {
      await nav('http://localhost:5173/clients');
      // Find a client
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h3, div, span'));
        const t = els.find(e => e.textContent.trim() === 'Kasargode');
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        if (rows.length > 0) rows[0].click();
      });
      await new Promise(r => setTimeout(r, 3000));
      
      // Go to pricing tab
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const t = btns.find(b => b.textContent.includes('Product Pricing'));
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 2000));
      
      const pricingRendered = await page.evaluate(() => document.body.innerText.includes('Kuboos') && document.body.innerText.includes('Roomali'));
      if (!pricingRendered) throw new Error('Client Pricing tab is not rendering products properly');
    });

    // ── Test 9: Firestore realtime sync ───────────────────────────────────────
    await test('Firestore realtime sync', async () => {
      // Create a test product programmatically and wait for UI to update
      await nav('http://localhost:5173/products');
      
      const prevRowCount = await page.evaluate(() => document.querySelectorAll('.max-w-5xl .group').length);
      
      const { doc, setDoc, deleteDoc } = require('firebase/firestore');
      
      const tempId = 'PROD-SYNC-TEST';
      await setDoc(doc(db, 'products', tempId), {
        id: tempId, name: 'SYNC TEST PRODUCT', status: 'active', displayOrder: 99
      });
      
      await new Promise(r => setTimeout(r, 3000));
      
      const newRowCount = await page.evaluate(() => document.querySelectorAll('.max-w-5xl .group').length);
      
      await deleteDoc(doc(db, 'products', tempId));
      
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
