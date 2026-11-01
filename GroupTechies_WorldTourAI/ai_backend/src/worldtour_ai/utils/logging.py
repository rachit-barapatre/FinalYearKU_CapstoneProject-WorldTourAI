"""Logging setup. Debug mode reveals provider and algorithm detail."""

from __future__ import annotations

import logging

from worldtour_ai.config.settings import get_settings


def get_logger(name: str = "worldtour") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.DEBUG if get_settings().debug_mode else logging.INFO)
    return logger
