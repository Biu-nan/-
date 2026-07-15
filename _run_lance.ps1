$env:USER_DATA_DIR = "F:\yikuaborder-deploy\users\lance"
$env:PORT = "3001"
$env:HOST = "0.0.0.0"
$env:CHROME_DEBUG_PORT = "9223"
Set-Location "F:\yikuaborder-deploy"
$p = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "dist/src/server.js" -RedirectStandardOutput "F:\yikuaborder-deploy\.lance-output.log" -RedirectStandardError "F:\yikuaborder-deploy\.lance-error.log" -PassThru
Write-Host $p.Id
