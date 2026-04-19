import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "node:crypto";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Google OAuth not configured" },
      { status: 500 }
    );
  }

  const { origin } = new URL(request.url);
  // Treat empty GOOGLE_REDIRECT_URI as unset — "" would be sent to Google and triggers
  // "Missing required parameter: redirect_uri" (invalid_request).
  const redirectFromEnv = process.env.GOOGLE_REDIRECT_URI?.trim();
  const redirectUri =
    redirectFromEnv && redirectFromEnv.length > 0
      ? redirectFromEnv
      : `${origin}/api/integrations/google-calendar/callback`;

  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );

  response.cookies.set("google_calendar_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
