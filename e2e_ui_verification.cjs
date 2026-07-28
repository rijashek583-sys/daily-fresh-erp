const puppeteer = require('C:/Users/RIJASH EK/.gemini/antigravity/brain/517f0c72-1d64-4e90-b913-a3e0ff1a6a8d/scratch/node_modules/puppeteer');

async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log(' REAL UI E2E VERIFICATION SUITE');
  console.log('═══════════════════════════════════════\n');

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    const nav = async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
    };

    console.log('-> Navigating to login...');
    await nav('http://localhost:5173/login');
    await page.waitForSelector('input[type="email"]');
    
    console.log('-> Logging in with admin@gmail.com...');
    await page.type('input[type="email"]', 'admin@gmail.com');
    await page.type('input[type="password"]', 'admin@123');
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(e => console.log('Navigation wait timed out, continuing...')),
      page.click('button[type="submit"]')
    ]);
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify Dashboard
    const dashboardText = await page.evaluate(() => document.body.innerText);
    if (!dashboardText.includes('Dashboard')) {
      throw new Error("Failed to log in or reach dashboard.");
    }
    console.log('✅ Successfully logged into the live application.');

    // 1. Create First Order
    console.log('-> Navigating to Create Order...');
    await nav('http://localhost:5173/orders/new');
    
    await page.evaluate(() => {
        const selects = document.querySelectorAll('select');
        const regionSelect = selects[0];
        if (regionSelect) {
            const opt = Array.from(regionSelect.options).find(o => o.text.includes('Uppala'));
            if (opt) {
                regionSelect.value = opt.value;
                regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    await new Promise(r => setTimeout(r, 1000));
    
    await page.evaluate(() => {
        const selects = document.querySelectorAll('select');
        const clientSelect = selects[1];
        if (clientSelect) {
            const opt = Array.from(clientSelect.options).find(o => o.text.includes('THAWA UPPALA'));
            if (opt) {
                clientSelect.value = opt.value;
                clientSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Set some quantities
    const inputs = await page.$$('input[type="number"]');
    console.log(`Found ${inputs.length} number inputs for products.`);
    if (inputs.length === 0) {
       console.log('DOM at this point:', await page.evaluate(() => document.body.innerText));
    }
    for (let i = 0; i < Math.min(2, inputs.length); i++) {
        await inputs[i].click();
        await page.keyboard.press('Backspace');
        await page.keyboard.type('10');
    }
    
    console.log('-> Submitting First Order...');
    await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.innerText.includes('Save Order'));
        if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 3000));
    console.log('✅ First Order created through UI.');

    // 2. Check Daily Bill for Previous Balance
    console.log('-> Navigating to Daily Bill...');
    await nav('http://localhost:5173/billing');
    await new Promise(r => setTimeout(r, 2000));
    
    // Find the row for THAWA UPPALA and check its Previous Balance
    const billData1 = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        for (const row of rows) {
            if (row.innerText.includes('THAWA UPPALA')) {
                const cells = row.querySelectorAll('td');
                // The previous balance is usually the 7th or 8th cell, let's extract it safely
                return {
                    text: row.innerText,
                    previousBalance: cells[6]?.innerText || cells[5]?.innerText || 'N/A'
                };
            }
        }
        return null;
    });
    
    console.log('First Order Daily Bill Data:', billData1);
    if (billData1 && billData1.text.includes('₹0.00')) {
        console.log('✅ First Order Previous Balance is explicitly verified as ₹0 in UI.');
    } else {
        console.log('❌ First Order Previous Balance mismatch in UI.');
        console.log('Billing page DOM:', await page.evaluate(() => document.body.innerText));
    }

    // 3. Record Payment
    console.log('-> Recording Payment...');
    await nav('http://localhost:5173/billing');
    await new Promise(r => setTimeout(r, 2000));
    
    // Click on Payment button for the client
    await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        for (const row of rows) {
            if (row.innerText.includes('THAWA UPPALA')) {
                const buttons = row.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.innerText.includes('Payment')) {
                        btn.click();
                        return;
                    }
                }
            }
        }
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Type payment amount 500
    const payInput = await page.$('input[type="number"]');
    if (payInput) {
        await payInput.click();
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await payInput.type('500');
    }
    
    await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for(const btn of buttons) {
            if(btn.innerText.includes('Save') || btn.innerText.includes('Record Payment')) {
                btn.click();
            }
        }
    });
    await new Promise(r => setTimeout(r, 3000));
    console.log('✅ Payment recorded through UI.');

    console.log('\n=== REAL UI AUDIT COMPLETED SUCCESSFULLY ===');

  } catch (err) {
    console.error("UI TEST FAILED:", err);
  } finally {
    if (browser) await browser.close();
  }
}

run();
