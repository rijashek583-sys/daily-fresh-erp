const puppeteer = require('C:/Users/RIJASH EK/.gemini/antigravity/brain/517f0c72-1d64-4e90-b913-a3e0ff1a6a8d/scratch/node_modules/puppeteer');

async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log(' TEST BROWSER - OPTIONAL PHONE VERIFICATION');
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
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

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

    // ── Test 1: Existing clients load without phone numbers ──────────────────
    await test('Existing clients load correctly without phone numbers', async () => {
      await nav('http://localhost:5173/clients');
      // Click into Kasargode
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h3, div, span'));
        const t = els.find(e => e.textContent.trim() === 'Kasargode');
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      const hasClients = await page.evaluate(() => document.querySelector('tbody') !== null);
      if (!hasClients) throw new Error('Client table not rendered');
      // Check no crash errors from phone access
      const crashErrors = errors.filter(e => e.includes('toLowerCase') || e.includes('undefined'));
      if (crashErrors.length > 0) throw new Error(`Runtime crash: ${crashErrors[0]}`);
    });

    // ── Test 2: Add Client form works without phone ───────────────────────────
    await test('New client can be created without phone number', async () => {
      await nav('http://localhost:5173/clients/new');
      await page.waitForSelector('input[placeholder*="SMOKEY"]');
      // Type name only
      await page.type('input[placeholder*="SMOKEY"]', 'TEST NO PHONE CLIENT');
      // Select region
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const t = btns.find(b => b.textContent.includes('Choose a region'));
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 500));
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const t = btns.find(b => b.textContent.trim() === 'Kasargode');
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 500));
      // Do NOT fill phone — click save
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const save = btns.find(b => b.textContent.includes('Save Client'));
        if (save) save.click();
      });
      await new Promise(r => setTimeout(r, 4000));
      // Should redirect back to clients
      const url = page.url();
      if (!url.includes('/clients')) throw new Error(`Did not redirect after save, URL: ${url}`);
      // Verify no phone-required error shown
      const phoneError = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Contact number is required') || text.includes('phone');
      });
      if (phoneError) throw new Error('Phone required error was still shown');
    });

    // ── Test 3: Search works without phone ────────────────────────────────────
    await test('Client search works without phone field', async () => {
      await nav('http://localhost:5173/clients');
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h3, div, span'));
        const t = els.find(e => e.textContent.trim() === 'Kasargode');
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 2000));
      const searchInput = await page.$('input[placeholder*="earch"]');
      if (!searchInput) throw new Error('No search input found');
      await searchInput.type('BAKUR');
      await new Promise(r => setTimeout(r, 1000));
      const hasBakur = await page.evaluate(() => document.body.innerText.includes('BAKUR'));
      if (!hasBakur) throw new Error('BAKUR not found in search results');
    });

    // ── Test 4: Orders page works ─────────────────────────────────────────────
    await test('Orders page loads without phone field errors', async () => {
      errors.length = 0;
      await nav('http://localhost:5173/orders');
      await new Promise(r => setTimeout(r, 2000));
      const criticalErrors = errors.filter(e => e.includes('TypeError') && e.includes('phone'));
      if (criticalErrors.length > 0) throw new Error(`Phone error in Orders: ${criticalErrors[0]}`);
      const loaded = await page.evaluate(() => document.body.innerText.includes('Order'));
      if (!loaded) throw new Error('Orders page did not load');
    });

    // ── Test 5: Billing page works ────────────────────────────────────────────
    await test('Daily Billing page loads without phone field errors', async () => {
      errors.length = 0;
      await nav('http://localhost:5173/billing');
      await new Promise(r => setTimeout(r, 2000));
      const criticalErrors = errors.filter(e => e.includes('TypeError') && e.includes('phone'));
      if (criticalErrors.length > 0) throw new Error(`Phone error in Billing: ${criticalErrors[0]}`);
      const loaded = await page.evaluate(() => document.body.innerText.includes('Bill') || document.body.innerText.includes('Date'));
      if (!loaded) throw new Error('Billing page did not load');
    });

    // ── Test 6: Client detail page shows no phone for production clients ──────
    await test('Client detail page hides phone when not present', async () => {
      await nav('http://localhost:5173/clients');
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h3, div, span'));
        const t = els.find(e => e.textContent.trim() === 'Kasargode');
        if (t) t.click();
      });
      await new Promise(r => setTimeout(r, 3000));
      // Click first row
      await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        if (rows.length > 0) rows[0].click();
      });
      await new Promise(r => setTimeout(r, 3000));
      const url = page.url();
      if (!url.includes('/clients/')) throw new Error(`Did not navigate to client detail, URL: ${url}`);
      // Page should NOT show 9999999999 or empty phone placeholder
      const hasPhoneText = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('9999999999') || text.includes('N/A') || text.includes('undefined');
      });
      if (hasPhoneText) throw new Error('Phone placeholder/dummy data visible in client detail');
    });

    // ── Test 7: No runtime errors across the app ──────────────────────────────
    await test('No runtime TypeError errors related to phone/email fields', async () => {
      errors.length = 0;
      await nav('http://localhost:5173/clients');
      await new Promise(r => setTimeout(r, 2000));
      const critErrors = errors.filter(e => (e.includes('phone') || e.includes('email')) && e.includes('TypeError'));
      if (critErrors.length > 0) throw new Error(critErrors[0]);
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
