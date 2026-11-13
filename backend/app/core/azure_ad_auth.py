"""
Azure AD authentication backend (Entra ID).
Handles OAuth2 OIDC flow for enterprise SSO.

When AUTH_BACKEND=azure_ad:
  - /auth/azure-ad/login  → redirects to Microsoft login
  - /auth/azure-ad/callback → exchanges code for token, creates/syncs user
  - Local JWT is issued after successful AD authentication
  - Users created automatically on first SSO login
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def get_auth_url(redirect_uri: str) -> str:
    """Build the Microsoft OAuth2 authorization URL."""
    from app.config import settings
    try:
        import msal
        app = _get_msal_app()
        result = app.get_authorization_request_url(
            scopes           = [settings.AZURE_AD_SCOPES],
            redirect_uri     = redirect_uri,
            response_type    = "code",
        )
        return result
    except Exception as e:
        logger.error(f"Azure AD auth URL failed: {e}")
        raise


def exchange_code(code: str, redirect_uri: str) -> Optional[dict]:
    """Exchange authorization code for tokens. Returns user info dict."""
    from app.config import settings
    try:
        app    = _get_msal_app()
        result = app.acquire_token_by_authorization_code(
            code         = code,
            scopes       = [settings.AZURE_AD_SCOPES],
            redirect_uri = redirect_uri,
        )
        if "error" in result:
            logger.error(f"Azure AD token exchange failed: {result.get('error_description')}")
            return None

        id_token_claims = result.get("id_token_claims", {})
        access_token    = result.get("access_token")

        # Fetch user profile from MS Graph
        user_info = _get_graph_profile(access_token) if access_token else {}

        return {
            "email":       id_token_claims.get("email") or id_token_claims.get("preferred_username", ""),
            "full_name":   id_token_claims.get("name", user_info.get("displayName", "")),
            "azure_oid":   id_token_claims.get("oid", ""),
            "department":  user_info.get("department", ""),
            "job_title":   user_info.get("jobTitle", ""),
            "access_token": access_token,
        }
    except Exception as e:
        logger.error(f"Azure AD token exchange exception: {e}")
        return None


def search_users(query: str, access_token: str, limit: int = 10) -> list:
    """Search Azure AD users — used for bid team member lookup."""
    try:
        import httpx
        resp = httpx.get(
            "https://graph.microsoft.com/v1.0/users",
            headers = {"Authorization": f"Bearer {access_token}"},
            params  = {
                "$search": f'"displayName:{query}" OR "mail:{query}"',
                "$top":    limit,
                "$select": "displayName,mail,jobTitle,department,id",
            },
            timeout = 10,
        )
        if resp.status_code == 200:
            return resp.json().get("value", [])
        return []
    except Exception as e:
        logger.warning(f"Azure AD user search failed: {e}")
        return []


def _get_msal_app():
    """Build MSAL ConfidentialClientApplication."""
    from app.config import settings
    import msal
    authority = settings.AZURE_AD_AUTHORITY or \
                f"https://login.microsoftonline.com/{settings.AZURE_AD_TENANT_ID}"
    return msal.ConfidentialClientApplication(
        client_id     = settings.AZURE_AD_CLIENT_ID,
        client_credential = settings.AZURE_AD_CLIENT_SECRET,
        authority     = authority,
    )


def _get_graph_profile(access_token: str) -> dict:
    """Fetch user profile from Microsoft Graph."""
    try:
        import httpx
        resp = httpx.get(
            "https://graph.microsoft.com/v1.0/me",
            headers = {"Authorization": f"Bearer {access_token}"},
            params  = {"$select": "displayName,mail,jobTitle,department"},
            timeout = 5,
        )
        return resp.json() if resp.status_code == 200 else {}
    except Exception:
        return {}


def is_configured() -> bool:
    from app.config import settings
    return bool(
        settings.AUTH_BACKEND == "azure_ad" and
        settings.AZURE_AD_TENANT_ID and
        settings.AZURE_AD_CLIENT_ID and
        settings.AZURE_AD_CLIENT_SECRET
    )
