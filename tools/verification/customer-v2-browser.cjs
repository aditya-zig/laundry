// Owned automated test browser only. No signed-in cloud sessions or real providers.
const {chromium, expect} = require('@playwright/test');
const {readFile,writeFile,mkdir} = require('node:fs/promises');
const {resolve} = require('node:path');
const {execFileSync} = require('node:child_process');
const {startFixture} = require('./customer-v2-fixture.cjs');
async function main(proposeAdjustment) {
  const output=resolve('.data/browser-evidence/customer-v2'); await mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage(); const mutations=[], decisions=[], errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    if(request.method() !== 'POST') return;
    const record = {key:request.headers()['idempotency-key'],body:request.postData()};
    if(request.url()==='http://127.0.0.1:4499/v2/orders') mutations.push(record);
    if(request.url().endsWith('/adjustments/decision')) decisions.push(record);
  });
  try {
    await page.goto('http://127.0.0.1:4219',{waitUntil:'networkidle'});
    await expect(page.getByLabel(/^Synthetic wash and fold\..*Open details$/)).toBeVisible();
    await expect(page.getByText('Indicative demo rate — not approved launch pricing')).toBeVisible();
    await page.screenshot({path:resolve(output,'catalog-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.getByLabel(/^Synthetic wash and fold\..*Open details$/).click();
    await page.getByLabel('Weight in kilograms for Synthetic wash and fold').fill('1.5');
    await page.getByRole('button',{name:'Add weight to bag',exact:true}).click();
    await page.getByRole('button',{name:'Review bag',exact:true}).click();
    await page.getByRole('button',{name:'Continue to booking',exact:true}).click();
    await page.getByLabel('Phone number',{exact:true}).fill('+919600000007');
    await page.getByRole('button',{name:'Send one-time code',exact:true}).click();
    await expect(page.getByLabel('One-time code',{exact:true})).toBeVisible();
    const otp=JSON.parse(await readFile('.data/customer-v2-private-otp.json','utf8'));
    await page.getByLabel('One-time code',{exact:true}).fill(otp.code);
    await page.getByRole('button',{name:'Verify code and continue',exact:true}).click();
    await page.getByLabel('Address label',{exact:true}).fill('Synthetic Home');
    await page.getByLabel('Street and building',{exact:true}).fill('1 Synthetic Test Street');
    await page.getByLabel('City',{exact:true}).fill('Bengaluru');
    await page.getByLabel('Six-digit PIN code',{exact:true}).fill('560001');
    await page.getByLabel('Pickup latitude',{exact:true}).fill('12.95');
    await page.getByLabel('Pickup longitude',{exact:true}).fill('77.6');
    await page.getByRole('button',{name:'Save pickup address',exact:true}).click();
    await page.getByRole('radio',{name:/^Pickup /}).first().click();
    await page.getByRole('button',{name:'Request quote',exact:true}).click();
    await expect(page.getByRole('button',{name:'Confirm booking',exact:true})).toBeEnabled();
    await page.screenshot({path:resolve(output,'quote-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Confirm booking',exact:true}).click();
    await expect(page.getByRole('button',{name:'Check booking again',exact:true})).toBeVisible();
    await page.screenshot({path:resolve(output,'unknown-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.getByRole('button',{name:'Continue to booking',exact:true}).click();
    await page.getByRole('button',{name:'Check booking again',exact:true}).click();
    await expect(page.getByLabel(/^Order identifier /)).toBeVisible();
    await page.screenshot({path:resolve(output,'confirmed-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'View order',exact:true}).click();
    await expect(page.getByText('Recorded history',{exact:true})).toBeVisible();
    await page.screenshot({path:resolve(output,'owned-order-mobile.png'),fullPage:true});
    expect(mutations).toHaveLength(2); expect(mutations[0].key).toBeTruthy(); expect(mutations[0]).toEqual(mutations[1]);
    const evidence=await (await fetch('http://127.0.0.1:4499/__synthetic_evidence')).json();
    expect(evidence).toEqual({syntheticOnly:true,orders:1,obligations:1,legs:1,confirmed_events:1,accepted_decisions:0});
    await proposeAdjustment();
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.getByRole('button',{name:'Accept revised total INR 100.00',exact:true}).click();
    await expect(page.getByRole('button',{name:'Check original accept decision',exact:true})).toBeVisible();
    await page.goBack();
    await page.getByRole('button',{name:'View order',exact:true}).click();
    const orderUrl = `http://127.0.0.1:4499/v2${new URL(page.url()).pathname}`;
    const reread = page.waitForResponse(response => response.url() === orderUrl && response.request().method() === 'GET');
    await page.getByRole('button',{name:'Check original accept decision',exact:true}).click();
    await reread;
    await expect(page.getByText(/^Adjustment accepted/)).toBeVisible();
    await expect(page.getByRole('button',{name:'Check original accept decision',exact:true})).toHaveCount(0);
    await expect(page.getByText(/^State: ACCEPTED\./)).toBeVisible();
    await expect(page.getByText('INR 100.00 · Payment due at return',{exact:true})).toBeVisible();
    await page.screenshot({path:resolve(output,'adjustment-accepted-mobile.png'),fullPage:true});
    expect(decisions).toHaveLength(2); expect(decisions[0].key).toBeTruthy(); expect(decisions[0]).toEqual(decisions[1]);
    const finalEvidence=await (await fetch('http://127.0.0.1:4499/__synthetic_evidence')).json();
    expect(finalEvidence).toEqual({...evidence,accepted_decisions:1});
    expect(errors).toEqual([]);
    await writeFile(resolve(output,'result.json'),JSON.stringify({status:'passed',sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()),syntheticOnly:true,commercialCalls:0,sameBookingKeyAndBody:true,sameAdjustmentKeyAndBody:true,...finalEvidence,browserErrors:errors},null,2));
    console.log('PASS: actual customer UI + SDK + compiled HTTP services + disposable PostgreSQL. First committed reply replaced by 503/unknown; navigation/retry reused key/body; exactly one order/obligation/pickup/event. Explicit intake-adjustment acceptance also survives reply loss/navigation with one decision audit. Synthetic OTP/prices/capacity only.');
  } catch(error) {
    console.error('Browser runtime errors:', errors);
    await page.screenshot({path:resolve(output,'failed.png'),fullPage:true}).catch(()=>{});
    await writeFile(resolve(output,'failed-body.txt'),await page.locator('body').innerText());
    throw error;
  } finally { await context.close(); await browser.close(); }
}
async function run() {
  const close = await startFixture();
  try { await main(close.proposeAdjustment); } finally { await close(); }
}
run().catch(error=>{console.error(error);process.exit(1);});
