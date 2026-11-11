import { createAuthClient } from 'better-auth/client';
import { phoneNumberClient } from 'better-auth/client/plugins';
import { createV2Client, type V2MutatingOpts } from './v2.js';

/** Browser cookies/state are managed by Better Auth, not localStorage or URL tokens.
 * Native callback and secure-storage handling require a separate platform adapter. */
export function createBrowserIdentityClient(options: { baseUrl: string; fetchImpl?: typeof fetch }) {
  const url = new URL(options.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v2') {
    throw new Error('Configure an HTTPS v2 API URL (HTTP is allowed only on loopback)');
  }
  const auth = createAuthClient({
    baseURL: url.origin,
    basePath: '/v2/auth/identity',
    plugins: [phoneNumberClient()],
    fetchOptions: { credentials: 'include', customFetchImpl: options.fetchImpl ?? fetch, retry: 0 },
  });
  return {
    auth,
    async exchange(opts: V2MutatingOpts = {}) {
      const result = await auth.getSession({ query: { disableCookieCache: true } });
      if (result.error) throw new Error(result.error.message ?? 'Sign in could not be checked');
      if (!result.data?.session.token) throw new Error('Sign in before continuing');
      // Never accept client-side phone flags as authorization; exchange rechecks the database.
      return createV2Client({ baseUrl: options.baseUrl.replace(/\/$/, ''), fetchImpl: options.fetchImpl,
        getToken: () => result.data!.session.token }).exchangeAuthSession(opts);
    },
  };
}
