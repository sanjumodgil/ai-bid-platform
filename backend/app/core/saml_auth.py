"""
SAML 2.0 authentication backend.
Supports any enterprise IdP: Okta, PingFederate, ADFS, Shibboleth.

When AUTH_BACKEND=saml:
  - /auth/saml/login    → redirects to IdP login page
  - /auth/saml/acs      → Assertion Consumer Service (receives SAML response)
  - /auth/saml/metadata → SP metadata for IdP registration

Requires: pip install python3-saml
Falls back to local JWT auth if not configured or package missing.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    from app.config import settings
    return bool(
        settings.AUTH_BACKEND == "saml" and
        settings.SAML_IDP_METADATA_URL and
        settings.SAML_SP_ENTITY_ID and
        settings.SAML_SP_ACS_URL
    )


def _get_saml_settings() -> dict:
    """Build python3-saml settings dict from config."""
    from app.config import settings
    return {
        "strict": True,
        "debug":  settings.DEBUG,
        "sp": {
            "entityId":   settings.SAML_SP_ENTITY_ID,
            "assertionConsumerService": {
                "url":     settings.SAML_SP_ACS_URL,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "x509cert": "",
            "privateKey": "",
        },
        "idp": {
            # Loaded from metadata URL at runtime
        },
    }


def get_login_url(request_url: str) -> Optional[str]:
    """Build the SAML authentication request URL."""
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
        req = _build_request(request_url)
        auth = OneLogin_Saml2_Auth(req, _get_saml_settings())
        return auth.login()
    except ImportError:
        logger.warning("python3-saml not installed — SAML auth unavailable. "
                       "Install on Python <=3.12 only: pip install python3-saml==1.16.0")
        return None
    except Exception as e:
        logger.error(f"SAML login URL failed: {e}")
        return None


def process_response(request_url: str, post_data: dict) -> Optional[dict]:
    """
    Process SAML response from IdP.
    Returns user info dict on success, None on failure.
    """
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
        req  = _build_request(request_url, post_data)
        auth = OneLogin_Saml2_Auth(req, _get_saml_settings())
        auth.process_response()

        errors = auth.get_errors()
        if errors:
            logger.error(f"SAML errors: {errors} — {auth.get_last_error_reason()}")
            return None

        if not auth.is_authenticated():
            logger.warning("SAML: not authenticated")
            return None

        attrs      = auth.get_attributes()
        name_id    = auth.get_nameid()          # typically email
        full_name  = (attrs.get("displayName")  or
                      attrs.get("http://schemas.microsoft.com/identity/claims/displayname") or
                      [name_id])[0]
        email      = (attrs.get("email") or
                      attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") or
                      [name_id])[0]
        department = (attrs.get("department") or [""])[0]
        job_title  = (attrs.get("title") or [""])[0]

        return {
            "email":      email.lower(),
            "full_name":  full_name,
            "department": department,
            "job_title":  job_title,
        }
    except ImportError:
        logger.warning("python3-saml not installed — SAML response processing unavailable. "
                       "Install on Python <=3.12: pip install python3-saml==1.16.0")
        return None
    except Exception as e:
        logger.error(f"SAML response processing failed: {e}")
        return None


def get_metadata() -> Optional[str]:
    """Generate SP metadata XML for registration with the IdP."""
    try:
        from onelogin.saml2.metadata import OneLogin_Saml2_Metadata
        sp_settings = _get_saml_settings()["sp"]
        metadata, errors = OneLogin_Saml2_Metadata.builder(sp_settings)
        return metadata
    except ImportError:
        return None
    except Exception as e:
        logger.error(f"SAML metadata generation failed: {e}")
        return None


def _build_request(url: str, post_data: dict = None) -> dict:
    """Build the request dict expected by python3-saml."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return {
        "https":           "on" if parsed.scheme == "https" else "off",
        "http_host":       parsed.netloc,
        "script_name":     parsed.path,
        "server_port":     parsed.port or (443 if parsed.scheme == "https" else 80),
        "get_data":        {},
        "post_data":       post_data or {},
        "query_string":    parsed.query,
    }
