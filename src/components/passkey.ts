"use client";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "./api";

export const passkeysSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential;

export async function registerPasskey(name = "This device") {
  const options = await api("/api/auth/passkey/register-options", { body: {} });
  const response = await startRegistration({ optionsJSON: options });
  return api<{ status: string; recoveryCodes: string[] | null }>("/api/auth/passkey/register-verify", { body: { response, name } });
}

/** Sign in, finish an MFA-pending sign-in, or step up — the server decides which. */
export async function authenticateWithPasskey() {
  const { ceremonyId, options } = await api("/api/auth/passkey/login-options", { body: {} });
  const response = await startAuthentication({ optionsJSON: options });
  return api<{ status: string }>("/api/auth/passkey/login-verify", { body: { ceremonyId, response } });
}
