import type { DbClient } from "../client";
import { decrypt, encrypt } from "../crypto";
import { upsertIntegration } from "./integrations";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleStoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

/**
 * Returns a valid OAuth access token for Google Calendar, refreshing with
 * refresh_token when close to expiry. Requires GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET in the process environment.
 */
export async function getGoogleCalendarAccessToken(
  db: DbClient,
  userId: string
): Promise<string | undefined> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;

  const { data: row, error } = await db
    .from("user_integrations")
    .select("encrypted_tokens, scopes")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .eq("status", "active")
    .maybeSingle();

  if (error || !row?.encrypted_tokens) return undefined;

  let bundle: GoogleStoredTokens;
  try {
    bundle = JSON.parse(decrypt(row.encrypted_tokens as string)) as GoogleStoredTokens;
  } catch {
    return undefined;
  }

  const now = Date.now();
  const skewMs = 90_000;
  if (bundle.access_token && bundle.expires_at && bundle.expires_at > now + skewMs) {
    return bundle.access_token;
  }

  if (!bundle.refresh_token) {
    return bundle.access_token;
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: bundle.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenJson.access_token) {
    console.error("Google OAuth refresh failed:", tokenJson);
    return undefined;
  }

  const expiresIn = (tokenJson.expires_in as number) || 3600;
  const newBundle: GoogleStoredTokens = {
    access_token: tokenJson.access_token as string,
    refresh_token: bundle.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
  };

  const scopes = (row.scopes as string[]) ?? [];
  await upsertIntegration(
    db,
    userId,
    "google_calendar",
    scopes,
    encrypt(JSON.stringify(newBundle))
  );

  return newBundle.access_token;
}
