"""Compatibility shim for older deduper logging imports."""

from loguru import logger


def get_logger():
    return logger
