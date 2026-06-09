param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$env:DEBUG = "true"

& .\.venv\Scripts\python.exe -m uvicorn app.main:app `
    --reload `
    --reload-dir . `
    --reload-include ".env" `
    --host $HostAddress `
    --port $Port
