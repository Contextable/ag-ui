import { OAuth2Client } from "google-auth-library";

let oauthClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (!oauthClient) {
    oauthClient = new OAuth2Client();
  }
  return oauthClient;
}

export interface AuthInfo {
  userId: string;
  email: string;
  oauthToken: string;
}

/**
 * Cache of OAuth token → user identity. Avoids hitting Google's userinfo
 * endpoint on every request. The OAuth token itself is a stable enough
 * cache key for the lifetime of the token (~1 hour).
 */
const userInfoCache = new Map<
  string,
  { userId: string; email: string; expiresAt: number }
>();
const USERINFO_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function fetchUserInfo(
  oauthToken: string,
): Promise<{ userId: string; email: string }> {
  const cached = userInfoCache.get(oauthToken);
  if (cached && cached.expiresAt > Date.now()) {
    return { userId: cached.userId, email: cached.email };
  }

  // Debug: ask Google what scopes the token actually has
  try {
    const tokenInfoRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(oauthToken)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (tokenInfoRes.ok) {
      const tokenInfo: any = await tokenInfoRes.json();
      console.log(
        `[auth] token scopes:`,
        tokenInfo.scope,
        `email:`,
        tokenInfo.email,
      );
    } else {
      console.log(`[auth] tokeninfo HTTP ${tokenInfoRes.status}`);
    }
  } catch (e) {
    console.log(`[auth] tokeninfo error:`, (e as Error).message);
  }

  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: { Authorization: `Bearer ${oauthToken}` },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new AuthError(`userinfo lookup failed: HTTP ${response.status}`);
  }

  const data: any = await response.json();
  const userId = data.sub;
  const email = data.email || userId;

  if (!userId) {
    throw new AuthError("userinfo response missing 'sub' field");
  }

  userInfoCache.set(oauthToken, {
    userId,
    email,
    expiresAt: Date.now() + USERINFO_CACHE_TTL_MS,
  });

  return { userId, email };
}

/**
 * Validates the Google bearer token and resolves user identity.
 *
 * Google Workspace Add-ons send:
 * - `Authorization` header: a JWT signed by Google's add-on service account
 *   (the `systemIdToken`) — this identifies Google, not the user
 * - `authorizationEventObject.userIdToken`: JWT with user identity claims
 *   (NOT always present — Gmail/Calendar omit this)
 * - `authorizationEventObject.userOAuthToken`: user's OAuth token for
 *   calling Google APIs on their behalf
 *
 * To get a stable user identifier, prefer `userIdToken` when available;
 * otherwise call the userinfo endpoint with `userOAuthToken`.
 */
export async function validateGoogleAuth(
  authHeader: string | undefined,
  userIdToken: string | undefined,
  oauthToken: string | undefined,
): Promise<AuthInfo> {
  // Preferred path: verify the user ID token for stable identity
  if (userIdToken) {
    try {
      const client = getOAuthClient();
      const ticket = await client.verifyIdToken({ idToken: userIdToken });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new AuthError("Invalid ID token payload");
      }
      return {
        userId: payload.sub!,
        email: payload.email || payload.sub!,
        oauthToken: oauthToken || "",
      };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(
        `ID token validation failed: ${(err as Error).message}`,
      );
    }
  }

  // Gmail/Calendar path: use OAuth token to look up user identity.
  // Falls back to a stable hash of the token if userinfo isn't authorized
  // (the userinfo scopes may not be granted on first install — caller
  // must request them via requestMissingScopes()).
  if (oauthToken) {
    try {
      const info = await fetchUserInfo(oauthToken);
      return {
        userId: info.userId,
        email: info.email,
        oauthToken,
      };
    } catch (err) {
      // Fallback: derive a stable user identifier from a non-rotating part
      // of the token. The full token rotates per-request, but the prefix
      // before the random portion is stable per-session for the user.
      console.log(
        `[auth] userinfo failed (${(err as Error).message}), using token-prefix fallback`,
      );
      return {
        userId: `oauth-user-${hashCode(oauthToken.slice(0, 32))}`,
        email: "user@unknown",
        oauthToken,
      };
    }
  }

  // Local dev path: hash the Authorization header
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    return {
      userId: `dev-user-${hashCode(token)}`,
      email: "dev@localhost",
      oauthToken: token,
    };
  }

  throw new AuthError("No valid credentials provided");
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Simple hash for dev fallback user IDs (only used when no OAuth token) */
function hashCode(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
