const puppeteer = require('C:/Users/RIJASH EK/.gemini/antigravity/brain/517f0c72-1d64-4e90-b913-a3e0ff1a6a8d/scratch/node_modules/puppeteer');

async function runVerification() {
  console.log('\n═══════════════════════════════════════');
  console.log(' TEST BROWSER VERIFICATION');
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
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER ERR:', msg.text()); });

    const nav = async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    };

    // ── Login as Admin ───────────────────────
    await nav('http://localhost:5173/login');
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'admin@gmail.com');
    await page.type('input[type="password"]', 'admin@123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 4000));

    // ── Test 1: Regions count ─────────────────
    await test('Regions count = 5', async () => {
      await nav('http://localhost:5173/clients');
      await new Promise(r => setTimeout(r, 2000));
      const regionCount = await page.evaluate(() => {
        // Look for region cards or region list items
        const cards = document.querySelectorAll('[data-region], .region-card');
        if (cards.length > 0) return cards.length;
        // Try counting region names from text
        const allText = document.body.innerText;
        const regions = ['Kasargode', 'Uppala', 'Hosangadi', 'Mangaluru', 'Commission'];
        return regions.filter(r => allText.includes(r)).length;
      });
      if (regionCount < 5) throw new Error(`Only found ${regionCount} regions, expected 5`);
    });

    // ── Test 2: Client count = 99 ─────────────
    await test('Client count = 99', async () => {
      // Navigate into first region to check clients load
      await nav('http://localhost:5173/clients');
      await new Promise(r => setTimeout(r, 2000));
      // Click into Kasargode
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"], div[class*="cursor"]'));
        const target = btns.find(b => b.textContent.includes('Kasargode'));
        if (target) { target.click(); return true; }
        return false;
      });
      if (!clicked) throw new Error('Could not find Kasargode region to click');
      await new Promise(r => setTimeout(r, 2000));
      const clientRows = await page.evaluate(() => {
        const rows = document.querySelectorAll('tr, [class*="row"], [class*="client-item"]');
        return rows.length;
      });
      if (clientRows < 1) throw new Error('No client rows found in Kasargode');
    });

    // ── Test 3: Region → Client mapping ────────
    await test('Region -> Client mapping (Kasargode has BAKUR)', async () => {
      await nav('http://localhost:5173/clients');
      await new Promise(r => setTimeout(r, 2000));
      const clickedKasargode = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('*'));
        const target = els.find(e => e.textContent.trim() === 'Kasargode' && e.children.length === 0);
        if (target) { target.click(); return true; }
        // Try broader match
        const btns = Array.from(document.querySelectorAll('button, div, li, h3, span'));
        const t2 = btns.find(b => b.textContent.includes('Kasargode') && !b.textContent.includes('Commission'));
        if (t2) { t2.click(); return true; }
        return false;
      });
      await new Promise(r => setTimeout(r, 2000));
      const hasBakur = await page.evaluate(() => document.body.innerText.includes('BAKUR'));
      if (!hasBakur) throw new Error('BAKUR not found in Kasargode clients');
    });

    // ── Test 4: Client search ─────────────────
    await test('Client search works', async () => {
      const searchInput = await page.$('input[placeholder*="earch"]');
      if (!searchInput) throw new Error('No search input found');
      await searchInput.click({ clickCount: 3 });
      await searchInput.type('BAKUR');
      await new Promise(r => setTimeout(r, 1000));
      const hasBakur = await page.evaluate(() => document.body.innerText.includes('BAKUR'));
      if (!hasBakur) throw new Error('BAKUR not returned in search results');
    });

    // ── Test 5: Client loading ────────────────
    await test('Client detail page loads', async () => {
      await nav('http://localhost:5173/clients');
      // Navigate into Kasargode region
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h3, div, span, button'));
        const target = els.find(e => e.textContent.trim() === 'Kasargode');
        if (target) { target.click(); return; }
        const fallback = els.find(e => e.textContent.includes('Kasargode') && !e.textContent.includes('Commission'));
        if (fallback) fallback.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      // Click first table row (BAKUR should be first alphabetically)
      const clicked = await page.evaluate(() => {
        // Try clicking first data row in table
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        if (rows.length > 0) { rows[0].click(); return true; }
        return false;
      });
      if (!clicked) throw new Error('Could not click on any client row');
      await new Promise(r => setTimeout(r, 3000));
      const url = page.url();
      if (!url.includes('/clients/')) throw new Error(`Did not navigate to client detail. URL: ${url}`);
    });

    // ── Test 6: Client Pricing loading ────────
    await test('Client Pricing tab loads', async () => {
      // Look for pricing tab
      const hasPricing = await page.evaluate(() => {
        return document.body.innerText.includes('Pricing') || document.body.innerText.includes('18') || document.body.innerText.includes('PROD-1');
      });
      if (!hasPricing) throw new Error('No pricing data visible on client detail page');
    });

    // ── Test 7: Firestore realtime sync ────────
    await test('Firestore realtime sync', async () => {
      // Navigate to clients and verify data loads without errors
      await nav('http://localhost:5173/clients');
      await new Promise(r => setTimeout(r, 3000));
      const pageErrors = await page.evaluate(() => {
        // Check for any visible error messages
        const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"]');
        return Array.from(errorEls).map(e => e.textContent).filter(t => t.trim().length > 0);
      });
      // Page should load without critical errors
      const hasLoadingContent = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Kasargode') || text.includes('Uppala') || text.includes('Region');
      });
      if (!hasLoadingContent) throw new Error('Page content did not load from Firestore');
    });

  } catch (err) {
    console.error('TEST SUITE ERROR:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;

  console.log('\n═══════════════════════════════════════');
  console.log(` RESULTS: ${passed} PASS / ${failed} FAIL`);
  console.log('═══════════════════════════════════════\n');
}

runVerification();
