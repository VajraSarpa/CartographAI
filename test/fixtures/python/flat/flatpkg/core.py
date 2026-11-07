from __future__ import annotations
import os
import requests
from typing import TYPE_CHECKING
from . import util
from .util import helper
import flatpkg.util
from flatpkg import not_a_module
import flatpkg.nope
from ... import too_far
from .typed import Shape
if TYPE_CHECKING:
    from flatpkg.util import Helper
else:
    from flatpkg import util as runtime_util
import importlib
plugin = importlib.import_module("flatpkg.util")
other = importlib.import_module(name)

def run():
    return helper()
