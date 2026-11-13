"""
Secrets backend adapter — db | env | azure_keyvault | hashicorp_vault
Reads SECRETS_BACKEND from config.

Usage:
    from app.core.secrets import get_secret, set_secret
    api_key = get_secret("llm_openai_api_key")
    set_secret("llm_openai_api_key", "sk-...")
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def get_secret(key: str) -> Optional[str]:
    """Get a secret value by key from the configured backend."""
    from app.config import settings
    backend = settings.SECRETS_BACKEND

    if backend == "env":
        return _get_from_env(key)
    elif backend == "azure_keyvault":
        return _get_from_keyvault(key)
    elif backend == "hashicorp_vault":
        return _get_from_vault(key)
    else:
        # "db" backend — secrets stored directly in LLMProviderConfig
        # The caller reads from DB directly; this path is rarely needed
        return None


def _get_from_env(key: str) -> Optional[str]:
    """Read from environment variables. Key mapped to ENV_VAR_NAME format."""
    import os
    env_key = key.upper().replace("-", "_").replace(".", "_")
    return os.environ.get(env_key)


def _get_from_keyvault(key: str) -> Optional[str]:
    """Read from Azure Key Vault."""
    try:
        from azure.keyvault.secrets import SecretClient
        from azure.identity import DefaultAzureCredential, ClientSecretCredential
        from app.config import settings

        # Use managed identity if no client credentials given
        if settings.AZURE_KEYVAULT_CLIENT_ID and settings.AZURE_KEYVAULT_SECRET:
            credential = ClientSecretCredential(
                tenant_id     = settings.AZURE_AD_TENANT_ID or "",
                client_id     = settings.AZURE_KEYVAULT_CLIENT_ID,
                client_secret = settings.AZURE_KEYVAULT_SECRET,
            )
        else:
            credential = DefaultAzureCredential()   # managed identity / CLI / env

        client = SecretClient(vault_url=settings.AZURE_KEYVAULT_URL, credential=credential)
        # Key Vault names must be alphanumeric + hyphens
        kv_name = key.replace("_", "-").lower()[:127]
        secret  = client.get_secret(kv_name)
        return secret.value
    except Exception as e:
        logger.error(f"Azure Key Vault get_secret({key}) failed: {e}")
        return None


def set_secret_to_keyvault(key: str, value: str) -> bool:
    """Write a secret to Azure Key Vault."""
    try:
        from azure.keyvault.secrets import SecretClient
        from azure.identity import DefaultAzureCredential, ClientSecretCredential
        from app.config import settings

        if settings.AZURE_KEYVAULT_CLIENT_ID and settings.AZURE_KEYVAULT_SECRET:
            credential = ClientSecretCredential(
                tenant_id     = settings.AZURE_AD_TENANT_ID or "",
                client_id     = settings.AZURE_KEYVAULT_CLIENT_ID,
                client_secret = settings.AZURE_KEYVAULT_SECRET,
            )
        else:
            credential = DefaultAzureCredential()

        client  = SecretClient(vault_url=settings.AZURE_KEYVAULT_URL, credential=credential)
        kv_name = key.replace("_", "-").lower()[:127]
        client.set_secret(kv_name, value)
        logger.info(f"Secret '{kv_name}' written to Azure Key Vault")
        return True
    except Exception as e:
        logger.error(f"Azure Key Vault set_secret({key}) failed: {e}")
        return False


def _get_from_vault(key: str) -> Optional[str]:
    """Read from HashiCorp Vault."""
    try:
        import httpx
        from app.config import settings

        resp = httpx.get(
            f"{settings.VAULT_URL}/v1/{settings.VAULT_PATH}/{key}",
            headers = {"X-Vault-Token": settings.VAULT_TOKEN or ""},
            timeout = 5,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("data", {}).get("data", {}).get(key) \
                or data.get("data", {}).get(key)  # KV v1 and v2
        logger.warning(f"Vault get {key} returned {resp.status_code}")
        return None
    except Exception as e:
        logger.error(f"HashiCorp Vault get_secret({key}) failed: {e}")
        return None


def test_secrets_backend() -> dict:
    """Test the configured secrets backend. Returns status dict."""
    from app.config import settings
    backend = settings.SECRETS_BACKEND
    try:
        if backend == "db":
            return {"status": "ok", "backend": "db",
                    "warning": "Secrets stored as plaintext in SQLite — use env or azure_keyvault for production"}
        elif backend == "env":
            return {"status": "ok", "backend": "env",
                    "note": "Secrets read from environment variables / .env file"}
        elif backend == "azure_keyvault":
            if not settings.AZURE_KEYVAULT_URL:
                return {"status": "error", "backend": "azure_keyvault", "error": "AZURE_KEYVAULT_URL not set"}
            from azure.keyvault.secrets import SecretClient
            from azure.identity import DefaultAzureCredential
            client = SecretClient(vault_url=settings.AZURE_KEYVAULT_URL, credential=DefaultAzureCredential())
            # List secrets to verify connectivity (doesn't expose values)
            list(client.list_properties_of_secrets(max_page_size=1))
            return {"status": "ok", "backend": "azure_keyvault", "url": settings.AZURE_KEYVAULT_URL}
        elif backend == "hashicorp_vault":
            if not settings.VAULT_URL:
                return {"status": "error", "backend": "hashicorp_vault", "error": "VAULT_URL not set"}
            import httpx
            resp = httpx.get(f"{settings.VAULT_URL}/v1/sys/health", timeout=5)
            return {"status": "ok" if resp.status_code in (200, 429, 472, 473) else "error",
                    "backend": "hashicorp_vault", "url": settings.VAULT_URL}
        else:
            return {"status": "warn", "backend": backend, "error": f"Unknown backend: {backend}"}
    except Exception as e:
        return {"status": "error", "backend": backend, "error": str(e)[:200]}
