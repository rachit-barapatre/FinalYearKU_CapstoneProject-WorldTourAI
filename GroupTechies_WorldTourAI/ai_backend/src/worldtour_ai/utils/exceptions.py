"""Structured exceptions used across providers and the workflow."""


class WorldTourError(Exception):
    """Base error for the travel optimizer."""


class ProviderError(WorldTourError):
    """An external provider failed."""


class RateLimitError(ProviderError):
    """The provider asked us to slow down."""


class QuotaExceededError(ProviderError):
    """The provider quota is exhausted."""


class EmptyResultError(ProviderError):
    """The provider returned no usable records."""


class ValidationError(WorldTourError):
    """Input failed validation."""


class ConfigurationError(WorldTourError):
    """The runtime configuration is unsafe or incomplete."""
