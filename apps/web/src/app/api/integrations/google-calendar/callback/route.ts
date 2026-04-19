import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, encrypt, upsertIntegration } from "@agents/db";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/settings?google_calendar=error&reason=${encodeURIComponent(errorParam)}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("google_calendar_oauth_state="))
    ?.split("=")[1];

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      `${origin}/settings?google_calendar=error&reason=state_mismatch`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/settings?google_calendar=error&reason=no_code`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${origin}/settings?google_calendar=error&reason=not_configured`
    );
  }

  const redirectFromEnv = process.env.GOOGLE_REDIRECT_URI?.trim();
  const redirectUri =
    redirectFromEnv && redirectFromEnv.length > 0
      ? redirectFromEnv
      : `${origin}/api/integrations/google-calendar/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;

  if (!tokenData.access_token) {
    console.error("Google token exchange failed:", tokenData);
    return NextResponse.redirect(
      `${origin}/settings?google_calendar=error&reason=token_exchange`
    );
  }

  const expiresIn = (tokenData.expires_in as number) || 3600;
  const bundle = {
    access_token: tokenData.access_token as string,
    refresh_token: (tokenData.refresh_token as string) || undefined,
    expires_at: Date.now() + expiresIn * 1000,
  };

  const encrypted = encrypt(JSON.stringify(bundle));
  const scopeStr = (tokenData.scope as string) || CALENDAR_SCOPE;
  const scopes = scopeStr.split(" ").filter(Boolean);

  const db = createServerClient();
  await upsertIntegration(db, user.id, "google_calendar", scopes, encrypted);

  const response = NextResponse.redirect(`${origin}/settings?google_calendar=connected`);
  response.cookies.delete("google_calendar_oauth_state");
  return response;
}
