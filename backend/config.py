import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Agora settings
AGORA_APP_ID = os.getenv("AGORA_APP_ID", "2e457a0905d845e898e2dd80ee130f0d")
AGORA_APP_CERTIFICATE = os.getenv("AGORA_APP_CERTIFICATE", "cb2cea1fcc1e4896a24e2a1b118cfc1e")

# Server settings
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1", "t")

# In production, replace with specific origins
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# Validate required settings
if not AGORA_APP_ID or not AGORA_APP_CERTIFICATE:
    print("Warning: Agora App ID or App Certificate not set in environment variables.")
    print("Please set AGORA_APP_ID and AGORA_APP_CERTIFICATE in your .env file")
    print("or as environment variables to enable video conferencing functionality.") 