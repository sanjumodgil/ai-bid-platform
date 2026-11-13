"""
LLM service — central access point for all AI generation.
Checks configuration before any call and raises a clear error if not set up.
Supports: Azure OpenAI, OpenAI, Anthropic, Google, Mistral, Ollama
"""
import json
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

class LLMNotConfiguredError(Exception):
    """Raised when LLM is not configured or API key is missing."""
    pass

def _get_llm_config() -> Optional[Dict]:
    """Read active LLM provider config from DB."""
    try:
        from app.database import engine
        from sqlmodel import Session, select
        from app.models import LLMProviderConfig
        with Session(engine) as session:
            cfg = session.exec(
                select(LLMProviderConfig).where(LLMProviderConfig.is_active == True)
            ).first()
            if not cfg:
                return None
            return {
                "provider":    cfg.provider,
                "model":       cfg.model,
                "api_key":     __import__('app.core.encryption', fromlist=['decrypt']).decrypt(cfg.api_key_encrypted),
                "endpoint":    cfg.endpoint,
                "api_version": getattr(cfg, 'api_version', '2024-02-01'),
            }
    except Exception as e:
        logger.warning(f"Could not read LLM config: {e}")
        return None

def get_llm_client():
    """
    Returns a configured LLM client.
    Raises LLMNotConfiguredError if no active provider is configured.
    """
    cfg = _get_llm_config()
    if not cfg:
        raise LLMNotConfiguredError(
            "No LLM provider is configured. "
            "Go to Settings → AI Configuration to add a provider."
        )
    if not cfg.get("api_key") and cfg["provider"] != "ollama":
        raise LLMNotConfiguredError(
            f"LLM provider '{cfg['provider']}' is configured but has no API key. "
            "Go to Settings → AI Configuration to add your API key."
        )
    return _build_client(cfg)

def _build_client(cfg: Dict):
    provider = cfg["provider"]

    if provider == "azure_openai":
        from openai import AzureOpenAI
        return AzureOpenAI(
            api_key        = cfg["api_key"],
            azure_endpoint = cfg["endpoint"],
            api_version    = cfg.get("api_version", "2024-02-01"),
        ), cfg

    elif provider == "openai":
        from openai import OpenAI
        return OpenAI(api_key=cfg["api_key"]), cfg

    elif provider == "anthropic":
        import anthropic
        return anthropic.Anthropic(api_key=cfg["api_key"]), cfg

    elif provider == "google":
        import google.generativeai as genai
        genai.configure(api_key=cfg["api_key"])
        return genai, cfg

    elif provider == "mistral":
        from mistralai.client import MistralClient
        return MistralClient(api_key=cfg["api_key"]), cfg

    elif provider == "ollama":
        import httpx
        return httpx.Client(base_url=cfg.get("endpoint", "http://localhost:11434")), cfg

    else:
        raise LLMNotConfiguredError(f"Unknown provider: {provider}")

def complete(
    prompt: str,
    system: str = "You are an expert bid writer helping prepare RFP responses.",
    max_tokens: int = 2000,
    temperature: float = 0.3,
) -> str:
    """
    Single completion call — handles all providers uniformly.
    Raises LLMNotConfiguredError if not configured.
    """
    client, cfg = get_llm_client()
    provider = cfg["provider"]
    model    = cfg["model"]

    try:
        if provider in ("azure_openai", "openai"):
            response = client.chat.completions.create(
                model       = model,
                messages    = [{"role": "system", "content": system},
                               {"role": "user",   "content": prompt}],
                max_tokens  = max_tokens,
                temperature = temperature,
            )
            return response.choices[0].message.content

        elif provider == "anthropic":
            response = client.messages.create(
                model      = model,
                max_tokens = max_tokens,
                system     = system,
                messages   = [{"role": "user", "content": prompt}],
            )
            return response.content[0].text

        elif provider == "google":
            model_obj = client.GenerativeModel(model)
            response  = model_obj.generate_content(f"{system}\n\n{prompt}")
            return response.text

        elif provider == "mistral":
            from mistralai.models.chat_completion import ChatMessage
            response = client.chat(
                model    = model,
                messages = [ChatMessage(role="system", content=system),
                            ChatMessage(role="user",   content=prompt)],
            )
            return response.choices[0].message.content

        elif provider == "ollama":
            import json as _json
            r = client.post("/api/generate", json={
                "model": model, "prompt": f"{system}\n\n{prompt}",
                "stream": False
            })
            return _json.loads(r.text)["response"]

        else:
            raise LLMNotConfiguredError(f"Unknown provider: {provider}")

    except LLMNotConfiguredError:
        raise
    except Exception as e:
        logger.error(f"LLM call failed ({provider}/{model}): {e}")
        raise RuntimeError(f"LLM call failed: {str(e)}")

def is_configured() -> bool:
    """Quick check — is LLM ready to use?"""
    try:
        cfg = _get_llm_config()
        return bool(cfg and (cfg.get("api_key") or cfg.get("provider") == "ollama"))
    except Exception:
        return False

def get_status() -> Dict:
    """Returns config status for the health check endpoint."""
    try:
        cfg = _get_llm_config()
        if not cfg:
            return {"configured": False, "reason": "No active LLM provider configured"}
        if not cfg.get("api_key") and cfg["provider"] != "ollama":
            return {"configured": False, "reason": f"Provider '{cfg['provider']}' has no API key"}
        return {"configured": True, "provider": cfg["provider"], "model": cfg["model"]}
    except Exception as e:
        return {"configured": False, "reason": str(e)}
