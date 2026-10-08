import sys
from pathlib import Path

# The image service's packages import as top-level (as uvicorn runs them).
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "image_service"))
