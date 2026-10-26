// Owned synthetic browser only. Read records; never create a customer payment or refund.
const {expect}=require('@playwright/test');
const {resolve}=require('node:path');
async function customerBillingJourney(page, output, settled) {
  await expect(page.getByText('Recorded payments',{exact:true})).toBeVisible();
  await expect(page.getByText('INR 100.00 · Pay-on-return model',{exact:true})).toBeVisible();
  await expect(page.getByText(settled?'Settled obligation':'Open obligation',{exact:true})).toBeVisible();
  // Before passed QC the obligation intentionally retains the original INR 60 booking amount.
  // Accepted care total is INR 100; the actual QC coordinator reconciles that before dispatch.
  await expect(page.getByText(`Recorded outstanding: INR ${settled?'0.00':'60.00'}`,{exact:true})).toBeVisible();
  await expect(page.getByText(/Do not treat that earlier amount as the final bill\./)).toBeVisible();
  if(settled) {
    await expect(page.getByText('Manual UPI confirmation · INR 100.00',{exact:true})).toBeVisible();
    await expect(page.getByText('Gateway capture recorded',{exact:false})).toHaveCount(0);
    const pattern='**/v2/orders/*/billing/receipts*'; let rejectedReads=0;
    const fail=async route=>{
      if(route.request().method()!=='GET') return route.continue();
      const original=await route.fetch(); // Preserve the real API's CORS/security headers.
      rejectedReads++;
      await route.fulfill({response:original,status:503,json:{code:'PROVIDER_OUTCOME_UNKNOWN',message:'Synthetic receipt read unavailable',traceId:'11111111-1111-4111-8111-111111111111',retryable:true}});
    };
    await page.route(pattern,fail);
    try {
      await page.getByRole('button',{name:'Refresh payment records',exact:true}).click();
      await expect(page.getByText('Payment records unavailable or incomplete',{exact:true})).toBeVisible();
      expect(rejectedReads).toBeGreaterThan(0);
      await expect(page.getByText('No receipts in the loaded records.',{exact:true})).toHaveCount(0);
      await expect(page.getByText(/^Recorded outstanding:/)).toHaveCount(0);
      await page.screenshot({path:resolve(output,'payment-records-read-failed-mobile.png'),fullPage:true});
    } finally { await page.unroute(pattern,fail); }
    await page.getByRole('button',{name:'Refresh payment records',exact:true}).click();
    await expect(page.getByText('Manual UPI confirmation · INR 100.00',{exact:true})).toBeVisible();
    await expect(page.getByText('Recorded outstanding: INR 0.00',{exact:true})).toBeVisible();
  } else await expect(page.getByText('No receipts in the loaded records.',{exact:true})).toBeVisible();
  await expect(page.getByText('No refunds in the loaded records.',{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(output,`payment-records-${settled?'settled':'open'}-mobile.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(settled) {
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:resolve(output,'payment-records-settled-desktop.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.setViewportSize({width:390,height:844});
  }
  return {ownedBillingRecordsVisible:true,manualReceiptNotGatewayCapture:settled,failedReadNotZeroBalance:settled};
}
module.exports={customerBillingJourney};
