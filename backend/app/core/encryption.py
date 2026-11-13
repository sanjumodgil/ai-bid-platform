"""
Encryption at rest for sensitive values (API keys, secrets).
Uses Fernet symmetric encryption — AES-128-CBC with HMAC-SHA256.

The encryption key is derived from SECRET_KEY in .env.
If SECRETS_BACKEND=db (dev), values are encrypted but key is in .env.
For production, move SECRET_KEY to Azure Key Vault or env vars.
"""
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def _get_fernet():
    """Build a Fernet cipher from the app SECRET_KEY."""
    try:
        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from app.config import settings
        import hashlib

        # Derive a 32-byte key from SECRET_KEY using PBKDF2
        salt = b"bid-platform-v1"   # fixed salt — key derivation only
        kdf = PBKDF2HMAC(
            algorithm = hashes.SHA256(),
            length    = 32,
            salt      = salt,
            iterations= 100_000,
        )
        key_bytes = kdf.derive(settings.SECRET_KEY.encode())
        fernet_key = base64.urlsafe_b64encode(key_bytes)
        return Fernet(fernet_key)
    except ImportError:
        logger.warning("cryptography package not installed — encryption disabled")
        return None
    except Exception as e:
        logger.error(f"Failed to build encryption key: {e}")
        return None


def encrypt(value: str) -> str:
    """
    Encrypt a plaintext string.
    Returns the ciphertext as a string prefixed with 'enc:'.
    Falls back to plaintext if cryptography is unavailable.
    """
    if not value:
        return value
    # Don't double-encrypt
    if value.startswith("enc:"):
        return value
    try:
        fernet = _get_fernet()
        if fernet is None:
            return value   # fallback — no encryption
        token = fernet.encrypt(value.encode())
        return f"enc:{token.decode()}"
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        return value   # fail open — store plaintext rather than crash


def decrypt(value: Optional[str]) -> Optional[str]:
    """
    Decrypt an encrypted string.
    Handles both encrypted ('enc:...') and legacy plaintext values transparently.
    """
    if not value:
        return value
    if not value.startswith("enc:"):
        return value   # legacy plaintext — return as-is
    try:
        fernet = _get_fernet()
        if fernet is None:
            return value.removeprefix("enc:")   # fallback
        token = value.removeprefix("enc:").encode()
        return fernet.decrypt(token).decode()
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        return None


def migrate_plaintext(value: Optional[str]) -> Optional[str]:
    """
    Encrypt a value if it isn't already encrypted.
    Safe to call on existing DB values — idempotent.
    """
    if not value or value.startswith("enc:"):
        return value
    return encrypt(value)
