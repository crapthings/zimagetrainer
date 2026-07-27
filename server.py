import os

import uvicorn

if __name__ == "__main__":
    # Bind to all interfaces so other devices on the trusted LAN can use the UI.
    uvicorn.run(
        "zimage_trainer.api:app",
        host="0.0.0.0",
        port=8000,
        # Auto-reload terminates child training/inference processes on Windows.
        # Keep the default launcher stable; opt in only when changing backend
        # code and no training task is active: set ZIMAGE_API_RELOAD=1.
        reload=os.getenv("ZIMAGE_API_RELOAD") == "1",
        reload_excludes=[".venv", ".logs", ".state", ".jobs", "data", "outputs", "ai-toolkit", "web"],
    )
