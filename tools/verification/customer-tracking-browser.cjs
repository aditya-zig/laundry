// Real SDK/API/PostgreSQL journey; only failure responses are intercepted in this owned synthetic browser.
const {expect}=require('@playwright/test');
const {resolve}=require('node:path');
const {reviewViewport}=require('./viewports.mjs');
async function customerTrackingJourney(page, output, phase) {
  const heading = phase==='booked'?'Booking confirmed':phase==='intake'?'At the laundry facility':'Delivered';
  await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  await expect(page.getByText('Pickup and return journeys',{exact:true})).toBeVisible();
  await expect(page.getByText('Custody record',{exact:true})).toBeVisible();
  await expect(page.getByText(/^Last checked: .*Updates are not live/)).toBeVisible();
  await expect(page.getByText(/These are scheduled windows, not a live arrival estimate/)).toBeVisible();
  await expect(page.getByText(/Times shown in Asia\/Kolkata/)).toBeVisible();
  if(phase==='booked') {
    await expect(page.getByText('No current handover confirmed',{exact:true})).toBeVisible();
    await expect(page.getByText('Measured weight',{exact:true}).locator('..')).toContainText('Not recorded');
    await expect(page.getByText('Delivered',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Returning to you',{exact:true})).toHaveCount(0);
  } else {
    await expect(page.getByText(phase==='intake'?'Facility receipt recorded':'Delivery recorded',{exact:true})).toBeVisible();
    await expect(page.getByText('Measured weight',{exact:true}).locator('..')).toContainText('2.4 kg');
  }
  await page.screenshot({path:resolve(output,`tracking-${phase}-mobile.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(phase!=='delivered') return;
  await page.setViewportSize(reviewViewport({width:1280,height:900}));
  await page.screenshot({path:resolve(output,'tracking-delivered-desktop.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.setViewportSize(reviewViewport({width:390,height:844}));

  const custodyPattern='**/v2/orders/*/custody-receipt'; let failedCustody=0;
  const failCustody=async route=>{
    const original=await route.fetch(); failedCustody++;
    await route.fulfill({response:original,status:503,json:{code:'PROVIDER_OUTCOME_UNKNOWN',message:'Synthetic custody read unavailable',traceId:'11111111-1111-4111-8111-111111111111',retryable:true}});
  };
  await page.route(custodyPattern,failCustody);
  try {
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByText('Custody update unavailable',{exact:true})).toBeVisible();
    await expect(page.getByText('Delivered',{exact:true})).toBeVisible();
    await expect(page.getByText('Recorded payments',{exact:true})).toBeVisible();
    await expect(page.getByText('Delivery recorded',{exact:true})).toHaveCount(0);
    expect(failedCustody).toBeGreaterThan(0);
    await page.screenshot({path:resolve(output,'tracking-custody-unavailable-mobile.png'),fullPage:true});
  } finally { await page.unroute(custodyPattern,failCustody); }
  await page.getByRole('button',{name:'Retry custody',exact:true}).click();
  await expect(page.getByText('Delivery recorded',{exact:true})).toBeVisible();

  const orderPattern=`**/v2${new URL(page.url()).pathname}`; let failedOrder=0;
  const failOrder=async route=>{
    const original=await route.fetch(); failedOrder++;
    await route.fulfill({response:original,status:503,json:{code:'PROVIDER_OUTCOME_UNKNOWN',message:'Synthetic order read unavailable',traceId:'11111111-1111-4111-8111-111111111111',retryable:true}});
  };
  const lastCheck=await page.getByText(/^Last checked:/).innerText();
  await page.route(orderPattern,failOrder);
  try {
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByText('Order update unavailable',{exact:true})).toBeVisible();
    await expect(page.getByText(/Showing the last available record, not a current confirmation/)).toBeVisible();
    await expect(page.getByText('Delivered',{exact:true})).toBeVisible();
    await expect(page.getByText(/^Last checked:/)).toHaveText(lastCheck);
    await expect(page.getByRole('button',{name:'Submit review',exact:true})).toHaveCount(0);
    expect(failedOrder).toBeGreaterThan(0);
    await page.screenshot({path:resolve(output,'tracking-stale-order-mobile.png'),fullPage:true});
  } finally { await page.unroute(orderPattern,failOrder); }
  await page.getByRole('button',{name:'Retry order update',exact:true}).click();
  await expect(page.getByText('Order update unavailable',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Submit review',exact:true})).toBeVisible();

  const timelinePattern='**/v2/orders/*/timeline'; let crossedRead=0;
  const crossTimeline=async route=>{
    const original=await route.fetch(), events=await original.json();
    expect(events.length).toBeGreaterThan(0); events[events.length-1].status='IN_CARE'; crossedRead++;
    await route.fulfill({response:original,json:events});
  };
  await page.route(timelinePattern,crossTimeline);
  try {
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByText('Order update unavailable',{exact:true})).toBeVisible();
    await expect(page.getByText(/Your order changed while updates were loading/)).toBeVisible();
    await expect(page.getByText('Delivered',{exact:true})).toBeVisible();
    expect(crossedRead).toBeGreaterThan(0);
  } finally { await page.unroute(timelinePattern,crossTimeline); }
  await page.getByRole('button',{name:'Retry order update',exact:true}).click();
  await expect(page.getByText('Order update unavailable',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Submit review',exact:true})).toBeVisible();
  return {eventDrivenTrackingBrowserProven:true,custodyReadFailureIsolated:true,failedOrderReadRetainsMarkedSnapshot:true,crossedTrackingReadsRejected:true};
}
module.exports={customerTrackingJourney};
