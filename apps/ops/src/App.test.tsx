import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('operations entry boundary', () => {
  it.each([undefined, 'false', '1'])('does not render demo authentication for flag %s', value => {
    vi.stubEnv('VITE_DEMO_MODE', value);
    vi.stubEnv('VITE_API_V2_URL', '');
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Operations console is not configured');
    expect(html).not.toContain('Continue with demo');
    expect(html).not.toContain('Acting role');
  });
  it('retains the legacy app only behind an explicit demo flag', () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('window', { location: { hash: '#/orders' } });
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('DEMO sign-in only');
  });
});
