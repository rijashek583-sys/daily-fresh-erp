const puppeteer = require('C:/Users/RIJASH EK/.gemini/antigravity/brain/517f0c72-1d64-4e90-b913-a3e0ff1a6a8d/scratch/node_modules/puppeteer');

async function runTests() {
  console.log('═══════════════════════════════════════');
  console.log(' FRESH E2E VERIFICATION SUITE');
  console.log('═══════════════════════════════════════\n');

  let browser;
  const results = [];
  
  const test = async (name, fn) => {
    console.log(`[TEST RUNNING] ${name}...`);
    try {
      await fn();
      results.push({ name, status: 'PASS' });
      console.log(`✅ PASS: ${name}`);
    } catch (e) {
      results.push({ name, status: 'FAIL', error: e.message });
      console.log(`❌ FAIL: ${name} - ${e.message}`);
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

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    // ── Login ──────────────────────────────────────────────
    await test('Login Workflow', async () => {
      await nav('http://localhost:5173/login');
      await page.type('input[type="email"]', 'admin@gmail.com');
      await page.type('input[type="password"]', 'admin@123');
      await page.click('button[type="submit"]');
      await wait(3000);
      const url = page.url();
      if (url.includes('/login')) throw new Error('Failed to login');
    });

    const divisions = ['primary', 'bakery'];
    const divNames = { primary: 'Primary Foods', bakery: 'Bakery Foods' };
    let clientIds = {};
    let productIds = {};

    for (const div of divisions) {
      console.log(`\n--- TESTING DIVISION: ${divNames[div]} ---`);
      
      // ── Division Switching ─────────────────────────────
      await test(`Switch Division to ${divNames[div]}`, async () => {
        await nav('http://localhost:5173/');
        await page.evaluate((dName) => {
          const btns = Array.from(document.querySelectorAll('button, a, div'));
          const target = btns.find(b => b.textContent.trim() === dName && b.className.includes('bg-[var(--color-primary)]'));
          if (!target) {
            const inactive = btns.find(b => b.textContent.trim() === dName);
            if (inactive) inactive.click();
          }
        }, divNames[div]);
        await wait(2000);
      });

      // ── Clients ─────────────────────────────────────────
      await test(`Create Client for ${divNames[div]}`, async () => {
        await nav('http://localhost:5173/clients/new');
        const cName = `Test Client ${div.toUpperCase()}`;
        
        await page.evaluate(() => {
          const selects = document.querySelectorAll('select');
          if (selects.length > 0) {
             const regionSelect = selects[0];
             const opt = Array.from(regionSelect.options).find(o => o.text.includes('Kasargode'));
             if (opt) {
                regionSelect.value = opt.value;
                regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
             }
          }
        });
        await wait(500);

        await page.type('input[placeholder*="SMOKEY"]', cName);
        await page.click('button[type="submit"]');
        await wait(2000);
        const url = page.url();
        if (url.includes('/new')) throw new Error('Client creation failed');
        clientIds[div] = cName;
      });

      // ── Products ────────────────────────────────────────
      await test(`Create Product for ${divNames[div]}`, async () => {
        await nav('http://localhost:5173/products/new');
        const pName = `Test Product ${div.toUpperCase()}`;
        
        const inputs = await page.$$('input[type="text"]');
        await inputs[0].type(pName); // name
        const numInputs = await page.$$('input[type="number"]');
        await numInputs[0].type('100'); // price

        await page.evaluate(() => {
           const btns = document.querySelectorAll('button');
           const saveBtn = Array.from(btns).find(b => b.textContent.includes('Save'));
           if (saveBtn) saveBtn.click();
        });
        await wait(2000);
        productIds[div] = pName;
      });

      // ── Client Pricing ──────────────────────────────────
      await test(`Client Pricing isolation for ${divNames[div]}`, async () => {
        await nav('http://localhost:5173/pricing');
        
        await page.evaluate((cName) => {
           const selects = document.querySelectorAll('select');
           const clientSelect = selects[0];
           if (clientSelect) {
               const opt = Array.from(clientSelect.options).find(o => o.text.includes(cName));
               if (opt) {
                   clientSelect.value = opt.value;
                   clientSelect.dispatchEvent(new Event('change', { bubbles: true }));
               }
           }
        }, clientIds[div]);
        await wait(2000);
        
        // Find the product input and set price
        await page.evaluate((pName) => {
           const rows = document.querySelectorAll('tbody tr');
           const targetRow = Array.from(rows).find(r => r.innerText.includes(pName));
           if (targetRow) {
               const input = targetRow.querySelector('input[type="number"]');
               if (input) {
                   input.value = '120';
                   input.dispatchEvent(new Event('input', { bubbles: true }));
               }
           }
        }, productIds[div]);
        await wait(1000);
        
        // Save pricing
        await page.evaluate(() => {
           const btns = document.querySelectorAll('button');
           const saveBtn = Array.from(btns).find(b => b.innerText.includes('Save Pricing'));
           if (saveBtn) saveBtn.click();
        });
        await wait(2000);

        const pageText = await page.evaluate(() => document.body.innerText);
        const otherDiv = div === 'primary' ? 'bakery' : 'primary';
        if (productIds[otherDiv] && pageText.includes(productIds[otherDiv])) {
           throw new Error(`Data Leak: Found product from ${otherDiv} in ${div} pricing!`);
        }
      });

      // ── Orders ──────────────────────────────────────────
      await test(`Create Order in ${divNames[div]}`, async () => {
        await nav('http://localhost:5173/orders/new');
        
        await page.evaluate((cName) => {
           const selects = document.querySelectorAll('select');
           const regionSelect = selects[0];
           if (regionSelect) {
               const opt = Array.from(regionSelect.options).find(o => o.text.includes('Kasargode'));
               if (opt) {
                   regionSelect.value = opt.value;
                   regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
               }
           }
        });
        await wait(1000);

        await page.evaluate((cName) => {
           const selects = document.querySelectorAll('select');
           const clientSelect = selects[1];
           if (clientSelect) {
               const opt = Array.from(clientSelect.options).find(o => o.text.includes(cName));
               if (opt) {
                   clientSelect.value = opt.value;
                   clientSelect.dispatchEvent(new Event('change', { bubbles: true }));
               }
           }
        }, clientIds[div]);
        await wait(2000);

        await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="number"]');
            if(inputs.length > 0) {
               inputs[0].focus();
            }
        });
        
        const numInputs = await page.$$('input[type="number"]');
        if (numInputs.length > 0) {
            await numInputs[0].click();
            await page.keyboard.press('Backspace');
            await numInputs[0].type('10');
        } else {
            throw new Error('No products available for order');
        }

        await page.evaluate(() => {
           const btns = document.querySelectorAll('button');
           const saveBtn = Array.from(btns).find(b => b.textContent.includes('Save Order'));
           if (saveBtn) saveBtn.click();
        });
        await wait(3000);
      });

      // ── Daily Bill & Previous Balance ───────────────────
      await test(`Daily Bill & Previous Balance for ${divNames[div]}`, async () => {
        await nav('http://localhost:5173/billing');
        await wait(3000);
        
        const hasBill = await page.evaluate((cName) => {
            return document.body.innerText.includes(cName);
        }, clientIds[div]);
        
        if (!hasBill) throw new Error('Order missing from Daily Bill');

        const isZeroPrev = await page.evaluate((cName) => {
            const rows = Array.from(document.querySelectorAll('tbody tr'));
            const targetRow = rows.find(r => r.innerText.includes(cName));
            if (targetRow) {
                return targetRow.innerText.includes('₹0.00');
            }
            return false;
        }, clientIds[div]);

        if (!isZeroPrev) throw new Error('Previous Balance is not exactly 0.00 for the first bill');
      });
    }

  } catch (err) {
    console.error('\nCRITICAL FAILURE:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  console.log('\n═══════════════════════════════════════');
  console.log(' TEST SUMMARY');
  console.log('═══════════════════════════════════════');
  results.forEach(r => {
    console.log(`${r.status === 'PASS' ? '✅' : '❌'} ${r.name}`);
    if (r.error) console.log(`   └─ Error: ${r.error}`);
  });
  console.log('═══════════════════════════════════════\n');
}

runTests();
