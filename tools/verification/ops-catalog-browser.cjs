// Current operator UI, published reads only; never approve or activate a rate.
const { expect } = require('@playwright/test');
const { resolve } = require('node:path');
const { reviewViewport } = require('./viewports.mjs');
async function opsCatalogJourney(page, output) {
  const writes = [], capture = request => { if (request.method() !== 'GET' && request.method() !== 'OPTIONS') writes.push(request.method()+' '+request.url()); };
  page.on('request',capture);
  const panel = page.getByRole('region',{name:'Catalog and effective rates',exact:true});
  const rows = () => panel.getByRole('row');
  const wash = () => rows().filter({hasText:'WASH_FOLD'});
  const dry = () => rows().filter({hasText:'DRY_CLEAN'});
  const ratePattern = '**/v2/catalog/rates/effective*';
  let failedRateReads = 0, failedCatalogReads = 0;
  const failRate = async route => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).searchParams.get('serviceCode') !== 'WASH_FOLD') return route.continue();
    const response = await route.fetch(); failedRateReads++;
    await route.fulfill({response,status:503,json:{code:'PROVIDER_UNAVAILABLE',message:'Synthetic rate read unavailable',traceId:'11111111-1111-4111-8111-111111111111',retryable:true}});
  };
  const catalogPattern = '**/v2/catalog/services';
  const failCatalog = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); failedCatalogReads++;
    await route.fulfill({response,status:503,json:{code:'PROVIDER_UNAVAILABLE',message:'Synthetic catalog read unavailable',traceId:'11111111-1111-4111-8111-111111111111',retryable:true}});
  };
  const viewport = page.viewportSize();
  try {
    await page.route(ratePattern,failRate);
    await page.getByText('Service and price configuration',{exact:true}).click();
    await expect(wash()).toContainText('Effective rate unavailable');
    await expect(wash()).not.toContainText('₹0.00');
    await expect(dry()).toContainText('₹25.00');
    await expect(dry()).toContainText('Demo rate — not approved launch pricing');
    expect(failedRateReads).toBeGreaterThan(0);
    await page.unroute(ratePattern,failRate);
    await panel.getByRole('button',{name:'Refresh catalog and rates',exact:true}).click();
    await expect(wash()).toContainText('₹40.00');
    await expect(wash()).toContainText('KG'); await expect(dry()).toContainText('PIECE');
    await expect(panel.getByText(/Image licensing evidence is not returned by these APIs/)).toBeVisible();
    await expect(panel.getByRole('button',{name:/publish|approve|activate|save/i})).toHaveCount(0);
    await page.screenshot({path:resolve(output,'ops-catalog-desktop.png'),fullPage:true});
    await page.setViewportSize(reviewViewport({width:390,height:844}));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await expect(panel.getByText('Demo rates shown — not approved launch pricing.',{exact:true})).toBeVisible();
    const table = panel.getByRole('region',{name:'Service rates table',exact:true});
    await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(dry().getByRole('cell',{name:'Demo rate — not approved launch pricing',exact:true})).toBeInViewport();
    await page.screenshot({path:resolve(output,'ops-catalog-mobile.png'),fullPage:true});
    await page.route(catalogPattern,failCatalog);
    await panel.getByRole('button',{name:'Refresh catalog and rates',exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText('Catalog records unavailable.');
    await expect(rows()).toHaveCount(0);
    await expect(panel.getByText('No services in the returned catalog.',{exact:true})).toHaveCount(0);
    expect(failedCatalogReads).toBeGreaterThan(0);
    await page.unroute(catalogPattern,failCatalog);
    await panel.getByRole('button',{name:'Refresh catalog and rates',exact:true}).click();
    await expect(wash()).toContainText('₹40.00'); await expect(dry()).toContainText('₹25.00');
    expect(writes).toEqual([]);
    await page.getByText('Service and price configuration',{exact:true}).click();
    return {opsCatalogReadOnlyProven:true,opsCatalogFailedReadsNotEmptyOrZero:true};
  } finally {
    await page.unroute(ratePattern,failRate); await page.unroute(catalogPattern,failCatalog);
    page.off('request',capture); if(viewport) await page.setViewportSize(viewport);
  }
}
module.exports={opsCatalogJourney};
