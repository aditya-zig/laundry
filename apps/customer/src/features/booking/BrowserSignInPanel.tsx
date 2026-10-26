import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getApiV2BaseUrl, getFoundation } from '../../foundation/session';
import { colors, minTouchTarget, radius, spacing } from '../../theme';
import { createCustomerBrowserSignIn } from './browser-sign-in';
import { nextSignInPrompt } from './checkout-flow';
import { Card, Loading, NoteCard } from './ui';

// Extend the existing Framed-sheet checkout, not a second sign-in design.
// One job: verify the pickup contact before a customer can book.
export function BrowserSignInPanel() {
  const [flow] = useState(() => createCustomerBrowserSignIn({ baseUrl: getApiV2BaseUrl(),
    adoptSession: session => getFoundation().adoptAuthenticatedSession(session) }));
  const [checking, setChecking] = useState(true);
  const [socialSession, setSocialSession] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setChecking(true); setError(null);
    try { setSocialSession(await flow.restore() === 'verifyPhone'); }
    catch { setError('Sign-in could not be restored. Retry sign-in before requesting another code.'); }
    finally { setChecking(false); }
  }
  useEffect(() => { void restore(); }, [flow]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-in could not finish. Try again.'); }
    finally { setBusy(false); }
  }
  async function send() {
    const prompt = nextSignInPrompt(phone);
    if (prompt.step === 'PHONE') { setError(prompt.reason); return; }
    await flow.sendCode(phone.trim()); setSent(true);
  }
  async function verify() {
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code.'); return; }
    await flow.verifyCode(phone.trim(), code.trim());
  }
  function social(provider: 'google' | 'apple') {
    // Fixed same-origin destination. Never pass tokens through redirect URLs.
    return flow.social(provider, `${window.location.origin}/checkout`);
  }

  return <Card title={socialSession ? 'Verify your mobile number' : 'Sign in to Laundry'}>
    {checking ? <Loading label="Checking sign-in" /> : <>
      <Text style={styles.body}>{socialSession
        ? 'Your social sign-in is connected. Verify your mobile number before booking; Google or Apple email verification is not enough.'
        : 'Use a mobile code, Google or Apple. Every account needs a verified mobile number for pickup and return.'}</Text>
      {!socialSession && !sent ? <View style={styles.providers}>
        {(['google', 'apple'] as const).map(provider => <Pressable key={provider}
          onPress={() => void run(() => social(provider))} disabled={busy}
          accessibilityRole="button" accessibilityState={{ disabled: busy }}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={styles.secondaryText}>Continue with {provider === 'google' ? 'Google' : 'Apple'}</Text>
        </Pressable>)}
      </View> : null}
      <Text style={styles.label}>Mobile number</Text>
      <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel"
        placeholder="+919876543210" placeholderTextColor={colors.inkMuted}
        editable={!sent && !busy} accessibilityLabel="Mobile number" style={styles.input} />
      {sent ? <>
        <Text style={styles.label}>6-digit code</Text>
        <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code"
          maxLength={6} editable={!busy} accessibilityLabel="One-time code" style={styles.input} />
        <Text style={styles.body}>Use the SMS code sent to this number. There is no demo code and no automatic resend.</Text>
      </> : null}
      <Pressable onPress={() => void run(sent ? verify : send)} disabled={busy}
        accessibilityRole="button" accessibilityState={{ disabled: busy }}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        <Text style={styles.primaryText}>{busy ? 'Please wait…' : sent ? 'Verify and continue' : 'Send one-time code'}</Text>
      </Pressable>
      {sent ? <Pressable onPress={() => { setSent(false); setCode(''); setError(null); }} disabled={busy}
        accessibilityRole="button" style={styles.link}>
        <Text style={styles.secondaryText}>Change number or request another code</Text>
      </Pressable> : null}
    </>}
    {error ? <NoteCard kind="error" title={error} actionLabel="Retry sign-in"
      actionDisabled={busy || checking} onAction={() => void restore()} /> : null}
    <Text style={styles.fine}>Email sign-in is not available. Your app session is memory-only in this build.</Text>
  </Card>;
}
const styles = StyleSheet.create({
  body: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  providers: { gap: spacing.sm, marginTop: spacing.md },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.sm },
  input: { color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, minHeight: minTouchTarget, paddingHorizontal: spacing.md, fontSize: 16 },
  primary: { minHeight: minTouchTarget, backgroundColor: colors.action, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },
  primaryText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  secondary: { minHeight: minTouchTarget, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.ink, fontSize: 15, fontWeight: '500' },
  link: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing.sm },
  fine: { color: colors.inkMuted, fontSize: 13, lineHeight: 20, marginTop: spacing.md },
  pressed: { opacity: 0.8 },
});
