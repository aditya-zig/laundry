// TASK-ONLY fixture. Disposable loopback DB, synthetic SMS/catalog/capacity.
// Exercises real compiled business services; never deploy or reuse this provider.
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { randomBytes, randomUUID } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const root = process.cwd(), compiled = resolve(root, 'apps/api/dist');
const req = createRequire(resolve(root, 'apps/api/package.json'));
req('reflect-metadata');
const { NestFactory } = req('@nestjs/core');
const { Module } = req('@nestjs/common');
const load = path => require(resolve(compiled, path));
async function startFixture() {
  if (process.env.LAUNDRY_SYNTHETIC_ACCEPTANCE !== 'true') throw Error('Explicit synthetic acceptance opt-in required');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_') || process.env.NODE_ENV === 'production') throw Error('Disposable local verification database only');
  process.env.NODE_ENV = 'test'; process.env.DEMO_MODE = 'false';
  const { getPool, initializeDb, closePool } = load('modules/shared/src/db.js');
  await initializeDb();
  const db = getPool();
  const clock = () => new Date();
  const { IdentityService } = load('modules/identity/src/index.js');
  const identity = new IdentityService({ db, clock, hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), provider: { mode: 'FAKE', async send(input) { await writeFile(resolve(root,'.data/customer-v2-private-otp.json'), JSON.stringify(input), { mode: 0o600 }); return { reference: `synthetic-${input.challengeId}` }; } } });
  const authenticate = token => identity.authenticate(token);
  const { CatalogService } = load('modules/catalog/src/index.js');
  const { AvailabilityService } = load('modules/availability/src/index.js');
  const { OrdersService } = load('modules/orders/src/index.js');
  const { BillingService, createObligationForOrder } = load('modules/billing/src/index.js');
  const { LogisticsService } = load('modules/logistics/src/index.js');
  const catalog = new CatalogService({ db, authenticate, clock });
  const availability = new AvailabilityService({ db, authenticate, clock });
  const billing = new BillingService({ db, authenticate, clock });
  const logistics = new LogisticsService({ db, authenticate, clock });
  const orders = new OrdersService({ db, authenticate, catalog, availability, clock, onBooked: async (order, tx) => { await createObligationForOrder(tx, { orderId: order.id, clock }); await logistics.openLegAttempt(order.id,'PICKUP',{ scheduledWindow: order.pickupWindow },tx); } });
  const now = new Date(), areaId = randomUUID(), facility = randomUUID(), serviceId = randomUUID();
  const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, start:'09:00',end:'18:00' }));
  await db.query(`INSERT INTO availability_areas (id,name,timezone,polygon,hours,slot_minutes,pickup_lead_minutes,booking_horizon_days,version,active,created_at,updated_at) VALUES ($1,'Synthetic browser test area','Asia/Kolkata',$2,$3,60,0,14,1,true,$4,$4)`, [areaId, JSON.stringify([{lat:12.9,lng:77.5},{lat:13,lng:77.5},{lat:13,lng:77.7},{lat:12.9,lng:77.7}]), JSON.stringify(hours),now]);
  await db.query('INSERT INTO availability_area_postal_codes(postal_code,area_id) VALUES($1,$2)', ['560001',areaId]);
  for (let day = 1; day <= 5; day++) { const start = new Date(now); start.setUTCDate(start.getUTCDate()+day); start.setUTCHours(3,30,0,0); const end = new Date(start.getTime()+3600000); await db.query(`INSERT INTO availability_buckets(id,facility_id,area_id,starts_at,ends_at,timezone,capacity,reserved,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'Asia/Kolkata',5,0,1,$6,$6)`,[randomUUID(),facility,areaId,start,end,now]); }
  await db.query(`INSERT INTO catalog_services(id,version,code,name,description,image_url,billing_unit,turnaround_hours,features,care_exclusions,active,created_at,updated_at) VALUES($1,1,'WASH_FOLD','Synthetic wash and fold','Browser acceptance fixture, not launch pricing.','https://assets.example.test/synthetic.png','KG',48,'[]','[]',true,$2,$2)`,[serviceId,now]);
  await db.query(`INSERT INTO catalog_rate_cards(id,version,service_codes,components,weight_increment_grams,minimum_billable_grams,rounding,effective_from,approved_at,activated_at,synthetic,created_at) VALUES($1,1,$2,$3,500,1000,'CEIL',$4,$5,$5,true,$5)`, [randomUUID(),JSON.stringify(['WASH_FOLD']),JSON.stringify([{label:'Synthetic per kg',kind:'PER_KG',amountMinor:4000,synthetic:true}]),new Date(now.getTime()-86400000),now]);
  const { IdentityModule } = load('apps/api/src/features/identity/identity.module.js');
  const { CatalogModule } = load('apps/api/src/features/catalog/catalog.module.js');
  const { AvailabilityModule } = load('apps/api/src/features/availability/availability.module.js');
  const { OrdersModule } = load('apps/api/src/features/orders/orders.module.js');
  const { ProductModule } = load('apps/api/src/features/product.module.js');
  class Fixture {}
  Module({imports:[IdentityModule.register(()=>identity),CatalogModule.register(()=>catalog),AvailabilityModule.register(()=>availability),OrdersModule.register(()=>orders),ProductModule.register({billing:()=>billing,logistics:()=>logistics})]})(Fixture);
  const app = await NestFactory.create(Fixture,{logger:false,rawBody:true});
  load('apps/api/src/http-body.js').configureHttpBody(app);
  app.useGlobalFilters(new (load('apps/api/src/filters/http-exception.filter.js').EnvelopeFilter)());
  app.enableCors({origin:'http://127.0.0.1:4219'});
  app.getHttpAdapter().get('/__synthetic_evidence', async (_request, response) => {
    const { rows } = await db.query(`SELECT (SELECT COUNT(*)::int FROM orders_v2_orders) AS orders, (SELECT COUNT(*)::int FROM billing_obligations) AS obligations, (SELECT COUNT(*)::int FROM logistics_leg_attempts) AS legs, (SELECT COUNT(*)::int FROM v2_outbox WHERE event_type='order.confirmed.v2') AS confirmed_events`);
    response.json({ syntheticOnly: true, ...rows[0] });
  });
  let dropNextBooking = true;
  app.use((request,response,next)=>{ const json=response.json.bind(response); response.json=body=>{ if(request.method==='POST' && request.path==='/v2/orders' && body?.id && dropNextBooking) { dropNextBooking=false; response.status(503); return json({code:'PROVIDER_OUTCOME_UNKNOWN',message:'Synthetic post-commit response loss',traceId:randomUUID(),retryable:true}); } return json(body); }; next(); });
  await app.listen(4499,'127.0.0.1');
  const {createPreviewServer} = await import(pathToFileURL(resolve(root,'tools/verification/serve-web.mjs')).href);
  const preview = await createPreviewServer(resolve(root,'apps/customer/dist'));
  await new Promise(resolve=>preview.listen(4219,'127.0.0.1',resolve));
  console.log('TASK-ONLY synthetic browser fixture ready: http://127.0.0.1:4219; first booking reply intentionally replaced by post-commit 503/unknown. No commercial SMS or production ordering.');
  return async function shutdown() { await new Promise(resolve=>preview.close(resolve)); await app.close(); await closePool(); };
}
module.exports = { startFixture };
if (require.main === module) startFixture().then(shutdown => {
  const stop = () => shutdown().then(() => process.exit(0));
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
}).catch(error=>{console.error(error.message);process.exit(1);});
