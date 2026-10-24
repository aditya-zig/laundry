export async function waitForGatewayRevision(url, revision, { fetcher = fetch, wait = ms => new Promise(accept => setTimeout(accept, ms)), attempts = 15 } = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('A full source revision is required');
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fetcher(new URL('/health/live', url), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (result.status === 200 && result.headers.get('content-type')?.includes('application/json')) {
        const body = await result.json();
        if (body.service === 'laundry-gateway' && body.alive === true && body.productionReady === false && body.revision === revision) return;
      }
    } catch { /* A bounded propagation retry, never a successful receipt. */ }
    if (i + 1 < attempts) await wait(2000);
  }
  throw new Error('The public gateway did not serve the expected committed revision; no deployment receipt issued');
}
