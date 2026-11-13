"""
File storage adapter — local disk | Azure Blob | AWS S3
Reads STORAGE_BACKEND from config. All methods return paths/URLs.

Usage:
    from app.core.storage import get_storage
    storage = get_storage()
    url = storage.save(file_bytes, filename, content_type)
    data = storage.get(filename)
    storage.delete(filename)
"""
import os
import io
import logging
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class StorageBase(ABC):
    @abstractmethod
    def save(self, data: bytes, filename: str, content_type: str = "application/octet-stream") -> str:
        """Save file, return accessible path/URL."""

    @abstractmethod
    def get(self, filename: str) -> Optional[bytes]:
        """Retrieve file bytes."""

    @abstractmethod
    def delete(self, filename: str) -> bool:
        """Delete file, return success."""

    @abstractmethod
    def exists(self, filename: str) -> bool:
        """Check if file exists."""

    @property
    @abstractmethod
    def backend_name(self) -> str:
        pass


class LocalStorage(StorageBase):
    """Store files on local disk — development only."""
    def __init__(self, upload_dir: str):
        self._dir = upload_dir
        os.makedirs(upload_dir, exist_ok=True)

    def save(self, data: bytes, filename: str, content_type: str = "application/octet-stream") -> str:
        path = os.path.join(self._dir, filename)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def get(self, filename: str) -> Optional[bytes]:
        path = os.path.join(self._dir, filename)
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return f.read()

    def delete(self, filename: str) -> bool:
        path = os.path.join(self._dir, filename)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False

    def exists(self, filename: str) -> bool:
        return os.path.exists(os.path.join(self._dir, filename))

    @property
    def backend_name(self) -> str:
        return "local"


class AzureBlobStorage(StorageBase):
    """Azure Blob Storage."""
    def __init__(self, connection_string: str, container: str):
        from azure.storage.blob import BlobServiceClient
        self._client    = BlobServiceClient.from_connection_string(connection_string)
        self._container = container
        # Ensure container exists
        try:
            self._client.create_container(container)
        except Exception:
            pass   # already exists

    def save(self, data: bytes, filename: str, content_type: str = "application/octet-stream") -> str:
        blob = self._client.get_blob_client(self._container, filename)
        blob.upload_blob(data, overwrite=True, content_settings={"content_type": content_type})
        return blob.url

    def get(self, filename: str) -> Optional[bytes]:
        try:
            blob = self._client.get_blob_client(self._container, filename)
            return blob.download_blob().readall()
        except Exception:
            return None

    def delete(self, filename: str) -> bool:
        try:
            blob = self._client.get_blob_client(self._container, filename)
            blob.delete_blob()
            return True
        except Exception:
            return False

    def exists(self, filename: str) -> bool:
        try:
            blob = self._client.get_blob_client(self._container, filename)
            return blob.exists()
        except Exception:
            return False

    @property
    def backend_name(self) -> str:
        return "azure_blob"


class S3Storage(StorageBase):
    """AWS S3 Storage."""
    def __init__(self, access_key: str, secret_key: str, bucket: str, region: str):
        import boto3
        self._s3     = boto3.client(
            "s3",
            aws_access_key_id     = access_key,
            aws_secret_access_key = secret_key,
            region_name           = region,
        )
        self._bucket = bucket
        self._region = region

    def save(self, data: bytes, filename: str, content_type: str = "application/octet-stream") -> str:
        self._s3.put_object(
            Bucket      = self._bucket,
            Key         = filename,
            Body        = data,
            ContentType = content_type,
        )
        return f"https://{self._bucket}.s3.{self._region}.amazonaws.com/{filename}"

    def get(self, filename: str) -> Optional[bytes]:
        try:
            resp = self._s3.get_object(Bucket=self._bucket, Key=filename)
            return resp["Body"].read()
        except Exception:
            return None

    def delete(self, filename: str) -> bool:
        try:
            self._s3.delete_object(Bucket=self._bucket, Key=filename)
            return True
        except Exception:
            return False

    def exists(self, filename: str) -> bool:
        try:
            self._s3.head_object(Bucket=self._bucket, Key=filename)
            return True
        except Exception:
            return False

    @property
    def backend_name(self) -> str:
        return "s3"


# ── Factory ───────────────────────────────────────────────────────

_instance: Optional[StorageBase] = None

def get_storage() -> StorageBase:
    global _instance
    if _instance is not None:
        return _instance

    from app.config import settings
    backend = settings.STORAGE_BACKEND.lower()

    if backend == "azure_blob":
        conn = settings.AZURE_STORAGE_CONNECTION_STRING
        if not conn:
            # Build from account name + key
            name = settings.AZURE_STORAGE_ACCOUNT_NAME
            key  = settings.AZURE_STORAGE_ACCOUNT_KEY
            if name and key:
                conn = f"DefaultEndpointsProtocol=https;AccountName={name};AccountKey={key};EndpointSuffix=core.windows.net"
        if not conn:
            logger.warning("Azure Blob: no connection string — falling back to local")
            _instance = LocalStorage(settings.UPLOAD_DIR)
        else:
            _instance = AzureBlobStorage(conn, settings.AZURE_STORAGE_CONTAINER)
            logger.info(f"Storage: Azure Blob ({settings.AZURE_STORAGE_CONTAINER})")

    elif backend == "s3":
        if not settings.AWS_ACCESS_KEY_ID or not settings.AWS_S3_BUCKET:
            logger.warning("S3: missing credentials — falling back to local")
            _instance = LocalStorage(settings.UPLOAD_DIR)
        else:
            _instance = S3Storage(
                settings.AWS_ACCESS_KEY_ID, settings.AWS_SECRET_ACCESS_KEY,
                settings.AWS_S3_BUCKET, settings.AWS_S3_REGION,
            )
            logger.info(f"Storage: S3 ({settings.AWS_S3_BUCKET})")
    else:
        _instance = LocalStorage(settings.UPLOAD_DIR)
        logger.info(f"Storage: local ({settings.UPLOAD_DIR})")

    return _instance

def reset_storage():
    global _instance
    _instance = None
