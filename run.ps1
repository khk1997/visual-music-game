$nodePath = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $nodePath)) {
  Write-Error "Node.js not found at $nodePath"
  exit 1
}

if (-not $env:OPENAI_API_KEY) {
  $secureKey = Read-Host "Enter your OpenAI API key" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

& $nodePath "index.mjs"
