"""
Integrations API — manages external service connections.
Currently supports: Azure AD (people search), SMTP (email)
"""
import json
import logging
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import get_session
from app.models import IntegrationConfig
from app.core.auth import get_current_user, require_admin

router = APIRouter(prefix="/integrations", tags=["integrations"])
logger = logging.getLogger(__name__)

# ── Pydantic schemas ──────────────────────────────────────────────

class IntegrationUpsert(BaseModel):
    name:    str
    enabled: bool = True
    config:  dict = {}

class AzureADConfig(BaseModel):
    tenant_id:     str
    client_id:     str
    client_secret: str

# ── Helpers ───────────────────────────────────────────────────────

def _get_or_create(session: Session, name: str) -> IntegrationConfig:
    obj = session.exec(select(IntegrationConfig).where(IntegrationConfig.name == name)).first()
    if not obj:
        obj = IntegrationConfig(name=name)
        session.add(obj)
        session.commit()
        session.refresh(obj)
    return obj

def _safe_config(obj: IntegrationConfig) -> dict:
    """Return config with secrets masked."""
    try:
        cfg = json.loads(obj.config_json or '{}')
    except Exception:
        cfg = {}
    masked = {}
    for k, v in cfg.items():
        if 'secret' in k.lower() or 'password' in k.lower() or 'key' in k.lower():
            masked[k] = '••••••••' if v else ''
        else:
            masked[k] = v
    return masked

# ── List all integrations ─────────────────────────────────────────

@router.get("/")
async def list_integrations(
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    integrations = session.exec(select(IntegrationConfig)).all()
    return [
        {
            "id":         i.id,
            "name":       i.name,
            "enabled":    i.enabled,
            "verified":   i.verified,
            "config":     _safe_config(i),
            "updated_at": i.updated_at.isoformat(),
        }
        for i in integrations
    ]

# ── Get single integration ────────────────────────────────────────

@router.get("/{name}")
async def get_integration(
    name: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    obj = session.exec(select(IntegrationConfig).where(IntegrationConfig.name == name)).first()
    if not obj:
        return {"name": name, "enabled": False, "verified": False, "config": {}}
    return {
        "id":         obj.id,
        "name":       obj.name,
        "enabled":    obj.enabled,
        "verified":   obj.verified,
        "config":     _safe_config(obj),
        "updated_at": obj.updated_at.isoformat(),
    }

# ── Save integration config ───────────────────────────────────────

@router.post("/{name}")
async def save_integration(
    name: str,
    data: IntegrationUpsert,
    session: Session = Depends(get_session),
    current_user = Depends(require_admin),
):
    obj = _get_or_create(session, name)

    # Merge config — preserve existing secrets if placeholder sent
    try:
        existing = json.loads(obj.config_json or '{}')
    except Exception:
        existing = {}

    merged = {**existing}
    for k, v in data.config.items():
        # Don't overwrite secrets with placeholder
        if v and v != '••••••••':
            merged[k] = v
        elif k not in merged:
            merged[k] = v

    obj.config_json = json.dumps(merged)
    obj.enabled     = data.enabled
    obj.verified    = False   # reset — needs re-test after config change
    obj.updated_at  = datetime.utcnow()
    session.add(obj)
    session.commit()
    session.refresh(obj)
    logger.info(f"Integration '{name}' config saved by {current_user.email}")
    return {"success": True, "name": name, "enabled": obj.enabled}

# ── Test Azure AD connection ──────────────────────────────────────

@router.post("/azure_ad/test")
async def test_azure_ad(
    session: Session = Depends(get_session),
    current_user = Depends(require_admin),
):
    obj = session.exec(select(IntegrationConfig).where(IntegrationConfig.name == "azure_ad")).first()
    if not obj or not obj.config_json:
        raise HTTPException(status_code=400, detail="Azure AD not configured.")

    try:
        cfg = json.loads(obj.config_json)
        token = await _get_ad_token(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
        # Try a simple search to verify permissions
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://graph.microsoft.com/v1.0/users?$top=1&$select=displayName",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
        if r.status_code == 200:
            obj.verified   = True
            obj.updated_at = datetime.utcnow()
            session.add(obj)
            session.commit()
            return {"success": True, "message": "Azure AD connection verified successfully."}
        else:
            raise HTTPException(status_code=400, detail=f"Graph API returned {r.status_code}: {r.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")

# ── Azure AD people search ────────────────────────────────────────

@router.get("/azure_ad/search")
async def search_ad_users(
    q: str,
    session: Session = Depends(get_session),
    current_user = Depends(get_current_user),
):
    """Search Azure AD users by name or email. Returns empty list if AD not configured."""
    if not q or len(q) < 2:
        return {"results": []}

    obj = session.exec(select(IntegrationConfig).where(IntegrationConfig.name == "azure_ad")).first()
    if not obj or not obj.enabled or not obj.verified:
        return {"results": [], "ad_available": False}

    try:
        cfg    = json.loads(obj.config_json or '{}')
        token  = await _get_ad_token(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://graph.microsoft.com/v1.0/users"
                f"?$search=\"displayName:{q}\" OR \"mail:{q}\""
                f"&$select=id,displayName,mail,jobTitle,department"
                f"&$top=10",
                headers={
                    "Authorization": f"Bearer {token}",
                    "ConsistencyLevel": "eventual",
                },
                timeout=8,
            )
        if r.status_code != 200:
            return {"results": [], "ad_available": True, "error": f"Graph API error {r.status_code}"}

        users = r.json().get("value", [])
        return {
            "results": [
                {
                    "ad_object_id": u.get("id"),
                    "display_name": u.get("displayName"),
                    "email":        u.get("mail"),
                    "job_title":    u.get("jobTitle"),
                    "department":   u.get("department"),
                }
                for u in users if u.get("displayName")
            ],
            "ad_available": True,
        }
    except Exception as e:
        logger.warning(f"AD search failed: {e}")
        return {"results": [], "ad_available": False, "error": str(e)}

# ── Helper: get AD token via client credentials flow ─────────────

async def _get_ad_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "grant_type":    "client_credentials",
                "client_id":     client_id,
                "client_secret": client_secret,
                "scope":         "https://graph.microsoft.com/.default",
            },
            timeout=10,
        )
    if r.status_code != 200:
        raise Exception(f"Token request failed: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]

# ── Test SMTP connection ──────────────────────────────────────────

@router.post("/smtp/test")
async def test_smtp(
    data: dict,
    session: Session = Depends(get_session),
    current_user = Depends(require_admin),
):
    """
    Test SMTP by sending a real test email to the admin's address.
    Accepts optional override config (so you can test before saving).
    """
    # Use provided config OR fall back to saved config
    obj = session.exec(select(IntegrationConfig).where(IntegrationConfig.name == "smtp")).first()
    try:
        saved = json.loads(obj.config_json or '{}') if obj else {}
    except Exception:
        saved = {}

    host      = data.get("host")      or saved.get("host")
    port      = int(data.get("port")  or saved.get("port") or 587)
    user      = data.get("user")      or saved.get("user", "")
    password  = data.get("password")  or saved.get("password", "")
    from_addr = data.get("from_address") or saved.get("from_address") or user

    if not host:
        raise HTTPException(status_code=400, detail="SMTP host is required.")

    # Replace placeholder passwords with saved value
    if password == "••••••••":
        password = saved.get("password", "")

    try:
        import smtplib, ssl
        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=8) as server:
            server.ehlo()
            if port == 587:
                server.starttls(context=context)
                server.ehlo()
            if user and password:
                server.login(user, password)

            # Send test email to the admin
            from email.mime.text import MIMEText
            msg = MIMEText(
                "This is a test email from your AI-Powered Bid Platform.\n\n"
                "If you received this, your SMTP configuration is working correctly.",
                "plain"
            )
            msg["Subject"] = "✓ SMTP Test — AI-Powered Bid Platform"
            msg["From"]    = from_addr
            msg["To"]      = current_user.email
            server.sendmail(from_addr, [current_user.email], msg.as_string())

        # Mark as verified in DB
        if obj:
            obj.verified   = True
            obj.updated_at = datetime.utcnow()
            session.add(obj)
            session.commit()

        return {
            "success": True,
            "message": f"Test email sent to {current_user.email}. Check your inbox."
        }

    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=400, detail="Authentication failed. Check your username and password.")
    except smtplib.SMTPConnectError:
        raise HTTPException(status_code=400, detail=f"Could not connect to {host}:{port}. Check the host and port.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SMTP test failed: {str(e)}")


# ── Test LLM configuration ────────────────────────────────────────

@router.post("/llm/test")
async def test_llm(
    data: dict,
    session: Session = Depends(get_session),
    current_user = Depends(require_admin),
):
    """
    Test LLM by making a minimal completion call.
    Accepts inline config so you can test before saving to DB.
    """
    provider  = data.get("provider", "").lower()
    model     = data.get("model", "")
    api_key   = data.get("api_key", "")
    endpoint  = data.get("endpoint", "")
    api_version = data.get("api_version", "2024-02-01")

    if not provider:
        raise HTTPException(status_code=400, detail="Provider is required.")

    # Replace placeholder
    if api_key == "••••••••":
        # Try to get saved key from DB
        from app.models import LLMProviderConfig
        saved = session.exec(
            select(LLMProviderConfig).where(LLMProviderConfig.provider == provider)
        ).first()
        api_key = saved.api_key_encrypted if saved else ""

    if not api_key and provider != "ollama":
        raise HTTPException(status_code=400, detail="API key is required.")

    test_prompt = "Reply with only the word 'OK' to confirm you are working."

    try:
        if provider == "azure_openai":
            from openai import AzureOpenAI
            client = AzureOpenAI(
                api_key=api_key, azure_endpoint=endpoint, api_version=api_version
            )
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": test_prompt}],
                max_tokens=10,
            )
            reply = resp.choices[0].message.content.strip()

        elif provider == "openai":
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": test_prompt}],
                max_tokens=10,
            )
            reply = resp.choices[0].message.content.strip()

        elif provider == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            resp = client.messages.create(
                model=model, max_tokens=10,
                messages=[{"role": "user", "content": test_prompt}]
            )
            reply = resp.content[0].text.strip()

        elif provider == "google":
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            m = genai.GenerativeModel(model)
            reply = m.generate_content(test_prompt).text.strip()

        elif provider == "mistral":
            from mistralai.client import MistralClient
            from mistralai.models.chat_completion import ChatMessage
            client = MistralClient(api_key=api_key)
            resp = client.chat(
                model=model,
                messages=[ChatMessage(role="user", content=test_prompt)]
            )
            reply = resp.choices[0].message.content.strip()

        elif provider == "ollama":
            import httpx, json as _json
            base = endpoint or "http://localhost:11434"
            r = httpx.post(
                f"{base}/api/generate",
                json={"model": model, "prompt": test_prompt, "stream": False},
                timeout=15,
            )
            reply = _json.loads(r.text).get("response", "").strip()

        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

        return {
            "success": True,
            "message": f"✓ {provider} ({model}) responded: \"{reply[:50]}\""
        }

    except HTTPException:
        raise
    except Exception as e:
        err = str(e)
        # Make common errors more readable
        if "401" in err or "authentication" in err.lower() or "api_key" in err.lower():
            detail = "Authentication failed — check your API key."
        elif "404" in err or "not found" in err.lower():
            detail = f"Model '{model}' not found. Check the model name."
        elif "connect" in err.lower() or "timeout" in err.lower():
            detail = f"Connection failed — check the endpoint URL."
        else:
            detail = f"Test failed: {err[:200]}"
        raise HTTPException(status_code=400, detail=detail)

# ── Secrets backend test ──────────────────────────────────────────
@router.post("/test-secrets")
async def test_secrets(current_user = Depends(require_admin)):
    """Test the configured secrets backend connection."""
    from app.core.secrets import test_secrets_backend
    result = test_secrets_backend()
    if not result.get("ok"):
        raise HTTPException(400, detail=result.get("error", "Secrets backend test failed"))
    return result
