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
async function startFixture({ withOps = false, withRider = false, withPickup = false } = {}) {
  if (withRider && !withOps) throw Error('Rider browser verification requires the ops journey');
  if (withPickup && !withRider) throw Error('Pickup browser verification requires the actual rider journey');
  if (process.env.LAUNDRY_SYNTHETIC_ACCEPTANCE !== 'true') throw Error('Explicit synthetic acceptance opt-in required');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_') || process.env.NODE_ENV === 'production') throw Error('Disposable local verification database only');
  process.env.NODE_ENV = 'test'; process.env.DEMO_MODE = 'false';
  const { getPool, initializeDb, closePool } = load('modules/shared/src/db.js');
  await initializeDb();
  const db = getPool();
  const clock = () => new Date();
  const { IdentityService } = load('modules/identity/src/index.js');
  const deliveries = new Map();
  const identity = new IdentityService({ db, clock, hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), provider: { mode: 'FAKE', async send(input) { deliveries.set(input.challengeId, input); await writeFile(resolve(root,'.data/customer-v2-private-otp.json'), JSON.stringify(input), { mode: 0o600 }); return { reference: `synthetic-${input.challengeId}` }; } } });
  const authenticate = token => identity.authenticate(token);
  const { CatalogService } = load('modules/catalog/src/index.js');
  const { AvailabilityService } = load('modules/availability/src/index.js');
  const { OrdersService } = load('modules/orders/src/index.js');
  const { BillingService, createObligationForOrder, reconcileObligationForReturn } = load('modules/billing/src/index.js');
  const { LogisticsService } = load('modules/logistics/src/index.js');
  const { ReviewsService } = load('modules/reviews/src/index.js');
  const reviews = new ReviewsService({ db, authenticate, clock });
  const { SupportService } = load('modules/support/src/index.js');
  const support = new SupportService({ db, authenticate, clock });
  const catalog = new CatalogService({ db, authenticate, clock });
  const availability = new AvailabilityService({ db, authenticate, clock });
  const { completeReturnWhenSettled } = load('modules/orders/src/completion.js');
  const { RecordingCustodyCodeNotifier } = load('modules/logistics/src/index.js');
  const custodyNotifier = new RecordingCustodyCodeNotifier();
  const billing = new BillingService({ db, authenticate, clock,
    onSettled: (id, tx, context) => completeReturnWhenSettled(tx, id, context) });
  const logistics = new LogisticsService({ db, authenticate, clock, custodyNotifier,
    custodyCodeSecret: randomBytes(32).toString('hex'),
    onReturnAccepted: (id, tx, context) => completeReturnWhenSettled(tx, id, context) });
  const orders = new OrdersService({ db, authenticate, catalog, availability, clock,
    loadDeliveryLegs: (ids, tx) => logistics.orderLegSummaries(ids, tx),
    onBooked: async (order, tx) => { await createObligationForOrder(tx, { orderId: order.id, clock }); await logistics.openLegAttempt(order.id,'PICKUP',{ scheduledWindow: order.pickupWindow },tx); },
    onReady: async (order, tx) => {
      const obligation = await reconcileObligationForReturn(tx, { orderId: order.id, clock });
      await logistics.openLegAttempt(order.id, 'RETURN', { scheduledWindow: order.promisedReturnWindow }, tx);
      return obligation;
    },
  });
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
  Module({imports:[IdentityModule.register(()=>identity),CatalogModule.register(()=>catalog),AvailabilityModule.register(()=>availability),OrdersModule.register(()=>orders),ProductModule.register({billing:()=>billing,logistics:()=>logistics,reviews:()=>reviews,support:()=>support})]})(Fixture);
  const app = await NestFactory.create(Fixture,{logger:false,rawBody:true});
  load('apps/api/src/http-body.js').configureHttpBody(app);
  app.useGlobalFilters(new (load('apps/api/src/filters/http-exception.filter.js').EnvelopeFilter)());
  app.enableCors({origin: withOps ? ['http://127.0.0.1:4219', 'http://127.0.0.1:4220', ...(withRider ? ['http://127.0.0.1:4221'] : [])] : 'http://127.0.0.1:4219'});
  app.getHttpAdapter().get('/__synthetic_evidence', async (_request, response) => {
    const { rows } = await db.query(`SELECT (SELECT COUNT(*)::int FROM orders_v2_orders) AS orders, (SELECT COUNT(*)::int FROM billing_obligations) AS obligations, (SELECT COUNT(*)::int FROM logistics_leg_attempts) AS legs, (SELECT COUNT(*)::int FROM v2_outbox WHERE event_type='order.confirmed.v2') AS confirmed_events, (SELECT COUNT(*)::int FROM v2_audit WHERE action='ADJUSTMENT_ACCEPTED') AS accepted_decisions`);
    response.json({ syntheticOnly: true, ...rows[0] });
  });
  app.getHttpAdapter().get('/__synthetic_ops_evidence', async (_request, response) => {
    const { rows } = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM v2_audit WHERE action='ORDER_INTAKE_RECORDED') AS intakes,
      (SELECT COUNT(*)::int FROM v2_audit WHERE action='QUALITY_CHECK_PASSED') AS qc_passes,
      (SELECT COUNT(*)::int FROM v2_audit WHERE action='QUALITY_CHECK_FAILED') AS qc_failures,
      (SELECT COUNT(*)::int FROM logistics_leg_attempts WHERE leg='RETURN') AS return_legs,
      (SELECT COUNT(*)::int FROM v2_outbox WHERE event_type='order.ready-for-return.v2') AS ready_events,
      (SELECT amount_due_minor::int FROM billing_obligations LIMIT 1) AS amount_due_minor`);
    response.json({ syntheticOnly: true, ...rows[0] });
  });
  app.getHttpAdapter().get('/__synthetic_dispatch_evidence', async (_request, response) => {
    const { rows } = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM logistics_assignments WHERE leg='RETURN') AS return_assignments,
      (SELECT COUNT(*)::int FROM logistics_handovers WHERE leg='RETURN' AND accepted) AS return_handovers,
      (SELECT COUNT(*)::int FROM billing_receipts WHERE confirmed_via <> 'GATEWAY_CAPTURE') AS manual_receipts,
      (SELECT COUNT(*)::int FROM billing_receipts WHERE confirmed_via = 'GATEWAY_CAPTURE') AS gateway_receipts,
      (SELECT amount_settled_minor::int FROM billing_obligations LIMIT 1) AS amount_settled_minor,
      (SELECT status FROM orders_v2_orders LIMIT 1) AS order_status`);
    response.json({ syntheticOnly: true, ...rows[0] });
  });
  app.getHttpAdapter().get('/__synthetic_reviews_evidence', async (_request, response) => {
    const { rows } = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM reviews_v2) AS reviews,
      (SELECT COUNT(*)::int FROM reviews_v2 WHERE publish_consent) AS publication_consents,
      (SELECT COUNT(*)::int FROM reviews_v2 WHERE publication='PUBLISHED') AS public_reviews`);
    response.json({ syntheticOnly: true, ...rows[0] });
  });
  app.getHttpAdapter().get('/__synthetic_support_evidence', async (_request, response) => {
    const { rows } = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM support_v2_incidents) AS incidents,
      (SELECT COUNT(*)::int FROM support_v2_incident_messages) AS messages,
      (SELECT COUNT(*)::int FROM support_v2_incident_messages WHERE author_role='CUSTOMER') AS customer_messages,
      (SELECT COUNT(*)::int FROM support_v2_incident_messages WHERE author_role IN ('OPERATOR','SUPPORT')) AS staff_messages,
      (SELECT COUNT(*)::int FROM v2_audit WHERE action='INCIDENT_OPENED') AS opened_audits,
      (SELECT COUNT(*)::int FROM v2_audit WHERE action='INCIDENT_MESSAGE_ADDED') AS message_audits,
      (SELECT version FROM orders_v2_orders LIMIT 1) AS order_version,
      (SELECT status FROM orders_v2_orders LIMIT 1) AS order_status`);
    response.json({ syntheticOnly: true, ...rows[0] });
  });
  let dropNextBooking = true, dropNextDecision = true, dropNextIntake = withOps, dropNextQualityPass = withOps,
    dropNextReceipt = withOps, dropNextReview = withOps,
    dropNextIncident = withOps, dropNextMessage = withOps;
  const lostAssignments = new Set(), lostAcceptances = new Set(), lostHandovers = new Set();
  app.use((request,response,next)=>{ const json=response.json.bind(response); response.json=body=>{
    const booking = request.path === '/v2/orders' && dropNextBooking;
    const decision = request.path.endsWith('/adjustments/decision') && dropNextDecision;
    const intake = request.path.endsWith('/intake') && dropNextIntake;
    const quality = request.path.endsWith('/quality-check') && body?.status === 'READY_FOR_RETURN' && dropNextQualityPass;
    const assignment = request.path === '/v2/ops/logistics/assignments' && withOps && !lostAssignments.has(body?.id);
    const receipt = request.path.endsWith('/confirm-manual') && dropNextReceipt;
    const review = request.path.endsWith('/reviews') && dropNextReview;
    const incident = /^\/v2\/orders\/[^/]+\/incidents$/.test(request.path) && dropNextIncident;
    const message = request.path.startsWith('/v2/incidents/') && request.path.endsWith('/messages') && dropNextMessage;
    const riderAcceptance = request.path.startsWith('/v2/rider/jobs/') && request.path.endsWith('/accept') && withRider && !lostAcceptances.has(body?.id);
    const riderHandover = request.path === '/v2/rider/handovers' && body?.accepted === true && withRider && !lostHandovers.has(body?.custodyEventId);
    if(request.method==='POST' && (body?.id || riderHandover) && (booking || decision || intake || quality || assignment || receipt || review || incident || message || riderAcceptance || riderHandover)) {
      if (booking) dropNextBooking = false; if (decision) dropNextDecision = false;
      if (intake) dropNextIntake = false; if (quality) dropNextQualityPass = false;
      if (assignment) lostAssignments.add(body.id); if (receipt) dropNextReceipt = false; if (review) dropNextReview = false;
      if (incident) dropNextIncident = false; if (message) dropNextMessage = false;
      if (riderAcceptance) lostAcceptances.add(body.id); if (riderHandover) lostHandovers.add(body.custodyEventId);
      response.status(503); return json({code:'PROVIDER_OUTCOME_UNKNOWN',message:'Synthetic post-commit response loss',traceId:randomUUID(),retryable:true});
    } return json(body);
  }; next(); });
  await app.listen(4499,'127.0.0.1');
  const {createPreviewServer} = await import(pathToFileURL(resolve(root,'tools/verification/serve-web.mjs')).href);
  const preview = await createPreviewServer(resolve(root,'apps/customer/dist'));
  await new Promise(resolve=>preview.listen(4219,'127.0.0.1',resolve));
  console.log('TASK-ONLY synthetic browser fixture ready: http://127.0.0.1:4219; first booking reply intentionally replaced by post-commit 503/unknown. No commercial SMS or production ordering.');
  const opsPreview = withOps ? await createPreviewServer(resolve(root,'apps/ops/dist')) : null;
  if (opsPreview) await new Promise(resolve => opsPreview.listen(4220, '127.0.0.1', resolve));
  const riderPreview = withRider ? await createPreviewServer(resolve(root, 'apps/partner/dist')) : null;
  if (riderPreview) await new Promise(resolve => riderPreview.listen(4221, '127.0.0.1', resolve));
  async function shutdown() {
    if (riderPreview) await new Promise(resolve => riderPreview.close(resolve));
    if (opsPreview) await new Promise(resolve => opsPreview.close(resolve));
    await new Promise(resolve=>preview.close(resolve)); await app.close(); await closePool();
  }
  let staffSession, pickupRider;
  // A task-only printed-label stand-in. Never generated by the rider app.
  shutdown.pickupBagId = withPickup ? randomUUID() : undefined;
  shutdown.preparePickupRider = async () => {
    if (!withPickup) throw Error('Explicit pickup browser opt-in required');
    if (!pickupRider) {
      const phone = '+919600000005', id = randomUUID();
      await db.query('INSERT INTO identity_staff(id,phone,role,created_at) VALUES($1,$2,$3,$4)', [randomUUID(), phone, 'RIDER', clock()]);
      await db.query('INSERT INTO identity_profiles(id,phone,created_at) VALUES($1,$2,$3)', [id, phone, clock()]);
      pickupRider = { actor: { id } };
    }
    return { riderId: pickupRider.actor.id };
  };
  shutdown.prepareOps = async () => {
    // Synthetic provisioning/pickup setup is NOT physical custody or staff-MFA acceptance.
    const phone = '+919600000008', consolePhone = '+919600000009';
    if (!staffSession) {
      await db.query('INSERT INTO identity_staff(id,phone,role,created_at) VALUES($1,$2,$3,$4)', [randomUUID(), phone, 'OPERATOR', clock()]);
      // Pickup setup and the browser console use different synthetic staff.
      // Reusing the setup phone would correctly hit the real 60-second OTP
      // cooldown; never relax that guard or rewrite challenge timestamps.
      if (withOps) await db.query('INSERT INTO identity_staff(id,phone,role,created_at) VALUES($1,$2,$3,$4)', [randomUUID(), consolePhone, 'OPERATOR', clock()]);
      const challenge = await identity.requestOtp({ phone }, randomUUID(), 'synthetic-fixture-staff');
      staffSession = await identity.verifyOtp({ challengeId: challenge.challengeId, code: deliveries.get(challenge.challengeId).code }, randomUUID(), 'synthetic-fixture-staff');
    }
    const row = (await db.query('SELECT id FROM orders_v2_orders ORDER BY created_at DESC LIMIT 1')).rows[0];
    const picked = withPickup
      ? await orders.getOrder(staffSession.accessToken, row.id)
      : await orders.markPickupPending(staffSession.accessToken, row.id);
    return { phone: withOps ? consolePhone : phone, picked };
  };
  shutdown.replyToSupport = async () => {
    // Real compiled staff authorization, synthetic setup identity. This is not
    // acceptance of a staffed support console or a live notification channel.
    if (!withOps || !staffSession) throw Error('Prepare synthetic staff before replying');
    const row = (await db.query('SELECT id FROM support_v2_incidents ORDER BY created_at DESC,id DESC LIMIT 1')).rows[0];
    if (!row) throw Error('The customer must open the case in the actual UI first');
    return support.appendMessage(staffSession.accessToken, row.id,
      { body: 'Synthetic operator acknowledgement; no refund or rewash promised.', mediaIds: [] }, randomUUID());
  };
  shutdown.proposeAdjustment = async () => {
    const { picked } = await shutdown.prepareOps();
    return orders.recordIntake(staffSession.accessToken, picked.id, { expectedVersion: picked.version, lines: [{ orderLineId: picked.lines[0].orderLineId, measuredWeightGrams: 2400, condition: 'GOOD' }], containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 12 }], mediaIds: [] }, randomUUID());
  };
  let returnRider;
  shutdown.prepareReturnRider = async () => {
    if (!withOps) throw Error('Ops journey opt-in required');
    if (!returnRider) {
      // The customer browser signs in with ...007. A rider must have its own
      // identity; sharing that phone both crosses roles and trips the OTP guard.
      const phone = '+919600000006';
      await db.query('INSERT INTO identity_staff(id,phone,role,created_at) VALUES($1,$2,$3,$4)', [randomUUID(), phone, 'RIDER', clock()]);
      if (withRider) {
        // Provision only: the actual rider UI must request and verify its own
        // OTP. Signing in here too correctly trips the real 60-second cooldown.
        const profileId = randomUUID();
        await db.query('INSERT INTO identity_profiles(id,phone,created_at) VALUES($1,$2,$3)', [profileId, phone, clock()]);
        returnRider = { actor: { id: profileId } };
      } else {
        const challenge = await identity.requestOtp({ phone }, randomUUID(), 'synthetic-return-rider');
        returnRider = await identity.verifyOtp({ challengeId: challenge.challengeId, code: deliveries.get(challenge.challengeId).code }, randomUUID(), 'synthetic-return-rider');
      }
    }
    return { riderId: returnRider.actor.id };
  };
  shutdown.syntheticRiderProof = async (leg = 'RETURN') => {
    const rider = leg === 'PICKUP' && withPickup ? pickupRider : leg === 'RETURN' ? returnRider : null;
    if (!withRider || !rider) throw Error('Explicit rider browser opt-in and provisioning required');
    const job = (await db.query(`SELECT leg_attempt_id AS id FROM logistics_assignments
      WHERE rider_id=$1 AND leg=$2 AND released_at IS NULL AND cancelled_at IS NULL`, [rider.actor.id, leg])).rows[0];
    const notification = custodyNotifier.latest();
    if (!job || notification?.legAttemptId !== job.id) throw Error('No matching synthetic task/code');
    return { jobId: job.id, code: notification.code, phone: leg === 'PICKUP' ? '+919600000005' : '+919600000006', bagId: leg === 'PICKUP' ? shutdown.pickupBagId : undefined };
  };
  shutdown.syntheticRiderOtp = (phone = '+919600000006') => {
    if (!withRider || !['+919600000006', ...(withPickup ? ['+919600000005'] : [])].includes(phone)) throw Error('Explicit rider browser opt-in required');
    const latest = [...deliveries.values()].filter(item => item.phone === phone).at(-1);
    if (!latest) throw Error('No synthetic rider OTP was requested');
    return latest.code;
  };
  shutdown.syntheticRiderEvidence = async (leg = 'RETURN') => {
    if (!withRider || !['RETURN', ...(withPickup ? ['PICKUP'] : [])].includes(leg)) throw Error('Explicit rider browser opt-in required');
    return (await db.query(`SELECT
      (SELECT COUNT(*)::int FROM v2_audit WHERE action='LOGISTICS_ASSIGNMENT_ACCEPTED') AS accepted_audits,
      (SELECT COALESCE(SUM(code_attempts),0)::int FROM logistics_assignments WHERE leg=$1) AS code_attempts,
      (SELECT COUNT(*)::int FROM logistics_handovers WHERE leg=$1) AS custody_handovers,
      (SELECT status FROM orders_v2_orders LIMIT 1) AS order_status`, [leg])).rows[0];
  };
  shutdown.syntheticBagEvidence = async () => {
    if (!withPickup) throw Error('Explicit pickup browser opt-in required');
    const handovers = (await db.query("SELECT leg,container_ids FROM logistics_handovers WHERE accepted=true ORDER BY created_at")).rows;
    const order = (await db.query('SELECT containers FROM orders_v2_orders ORDER BY created_at DESC LIMIT 1')).rows[0];
    return {
      pickup: handovers.filter(row => row.leg === 'PICKUP').flatMap(row => row.container_ids),
      returned: handovers.filter(row => row.leg === 'RETURN').flatMap(row => row.container_ids),
      facility: order.containers.map(bag => bag.id),
    };
  };
  shutdown.acceptSyntheticReturnCustody = async () => {
    // Real compiled custody rules, synthetic notifier/rider facts. This proves
    // no device behaviour, physical transfer, location or production channel.
    if (!withOps || !returnRider || withRider) throw Error('Service-only custody is forbidden when the actual rider browser is selected');
    const jobs = await logistics.listRiderJobs(returnRider.accessToken);
    const job = jobs.find(item => item.leg === 'RETURN');
    if (!job) throw Error('Return assignment must come from the actual ops UI');
    const code = custodyNotifier.latest();
    if (!code || code.legAttemptId !== job.id) throw Error('No matching synthetic custody notification');
    await logistics.acceptJob(returnRider.accessToken, job.id, { expectedVersion: job.version }, randomUUID());
    return logistics.recordHandover(returnRider.accessToken, {
      jobId: job.id, legAttemptId: job.id, expectedVersion: job.version,
      actionId: randomUUID(), method: 'CODE', code: code.code,
      capturedAt: clock().toISOString(), containerIds: job.containerIds,
      garmentCount: 12, condition: 'GOOD',
    }, randomUUID());
  };
  return shutdown;
}
module.exports = { startFixture };
if (require.main === module) startFixture().then(shutdown => {
  const stop = () => shutdown().then(() => process.exit(0));
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
}).catch(error=>{console.error(error.message);process.exit(1);});
