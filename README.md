# jarvis-web-os-
# JARVIS Web OS

A futuristic AI dashboard powered by GLM, featuring:
- **Command Hub** — text/voice commands with streaming responses
- **AI Tool Radar** — daily discovery of emerging AI tools
- **LinkedIn Studio** — auto-generated post drafts
- **Execution Log** — real-time system event stream

## Stack
- **Backend:** Node.js + Express
- **AI:** GLM (via OpenAI-compatible API)
- **Frontend:** Vanilla HTML/CSS/JS

## Deploy on Render

1. Fork this repository.
2. Create a **Web Service** on [render.com](https://render.com).
3. Set environment variables:
   - `GLM_API_KEY` = your NVIDIA NIM or Zhipu key
   - `GLM_BASE_URL` = `https://integrate.api.nvidia.com/v1`
   - `GLM_MODEL` = `z-ai/glm-4.7`
4. Deploy. UptimeRobot every 5 minutes keeps it awake.

## License
MIT