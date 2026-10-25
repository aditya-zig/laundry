// F04 sign-in: staff OTP with an optional enrolled TOTP second factor.
// Public identity endpoints go through the plain v2 client surface (in the app
// binding that is `getV2Client` from src/foundation/session.ts); the verified
// session is adopted through the session foundation so access tokens stay in
// memory and refresh rotation keeps one key per attempt.
import { type V2Client } from "@laundry/api-client";
import type { SessionFoundation } from "@laundry/app-foundation";
import { v2 } from "@laundry/contracts";
import { describeError, type PresentableError } from "./errors";

export type SignInState =
  | { phase: "collectPhone" }
  | { phase: "requesting" }
  | { phase: "collectCode"; challengeId: string; expiresAt: string; verifying?: boolean }
  | { phase: "signedIn"; actor: v2.Actor };

export interface SignInDeps {
  foundation: SessionFoundation;
  /** Unauthenticated surface for the public identity endpoints. */
  publicClient: () => V2Client;
}

export class SignInController {
  private state: SignInState = { phase: "collectPhone" };
  private error: PresentableError | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SignInDeps) {}

  getState(): SignInState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  lastError(): PresentableError | null {
    return this.error;
  }

  private set(state: SignInState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  private renderableError(error: unknown): PresentableError {
    return describeError(error);
  }

  /** Restore a stored session on first mount. Browser defaults are memory
   * only, so this usually lands on the sign-in sheet. */
  async restore(): Promise<void> {
    const snapshot = await this.deps.foundation.initialize();
    if (snapshot.state === "authenticated") {
      this.error = null;
      this.set({ phase: "signedIn", actor: snapshot.actor });
      return;
    }
    if (snapshot.state === "restoreFailed") {
      this.error = {
        code: "SESSION_RESTORE_FAILED",
        message: "The stored session could not be restored. Sign in again.",
        traceId: undefined,
        retryable: false,
        currentVersion: undefined,
        unknownOutcome: false,
      };
    }
    this.set({ phase: "collectPhone" });
  }

  async requestOtp(phone: string): Promise<void> {
    const parsed = v2.otpRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      this.error = {
        code: "INVALID_INPUT",
        message: "Enter a staff phone in international format, for example +91 followed by ten digits.",
        traceId: undefined,
        retryable: false,
        currentVersion: undefined,
        unknownOutcome: false,
      };
      this.set({ phase: "collectPhone" });
      return;
    }
    this.set({ phase: "requesting" });
    try {
      const challenge = await this.deps.publicClient().requestOtp(parsed.data.phone);
      this.error = null;
      this.set({
        phase: "collectCode",
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
      });
    } catch (error) {
      this.error = this.renderableError(error);
      this.set({ phase: "collectPhone" });
    }
  }

  async verifyOtp(code: string, mfaCode?: string): Promise<void> {
    const current = this.state;
    if (current.phase !== "collectCode") return;
    const parsed = v2.otpVerifySchema.safeParse({
      challengeId: current.challengeId,
      code,
      ...(mfaCode ? { mfaCode } : {}),
    });
    if (!parsed.success) {
      this.error = {
        code: "INVALID_INPUT",
        message: "Codes are six digits. Enter them exactly as received, or as shown by the authenticator.",
        traceId: undefined,
        retryable: false,
        currentVersion: undefined,
        unknownOutcome: false,
      };
      this.set({ ...current, verifying: false });
      return;
    }
    this.set({ ...current, verifying: true });
    try {
      // Provisioned staff additionally prove the enrolled second factor here.
      const session = await this.deps
        .publicClient()
        .verifyOtp(parsed.data.challengeId, parsed.data.code, {
          ...(parsed.data.mfaCode === undefined ? {} : { mfaCode: parsed.data.mfaCode }),
        });
      await this.deps.foundation.adoptAuthenticatedSession(session);
      const actor = this.deps.foundation.getActor();
      this.error = null;
      this.set({ phase: "signedIn", actor: actor ?? session.actor });
    } catch (error) {
      this.error = this.renderableError(error);
      const snapshot = this.state;
      if (snapshot.phase === "collectCode") {
        this.set({
          phase: "collectCode",
          challengeId: snapshot.challengeId,
          expiresAt: snapshot.expiresAt,
          verifying: false,
        });
        return;
      }
      this.set({ phase: "collectPhone" });
    }
  }

  sessionChanged(): void {
    const actor = this.deps.foundation.getActor();
    this.error = null;
    this.set(actor ? { phase: "signedIn", actor } : { phase: "collectPhone" });
  }

  backToPhone(): void {
    this.error = null;
    this.set({ phase: "collectPhone" });
  }

  async signOut(): Promise<void> {
    await this.deps.foundation.logout();
    this.error = null;
    this.set({ phase: "collectPhone" });
  }
}
