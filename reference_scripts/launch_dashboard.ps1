# Lance le Dashboard Next.js de Novahiz
$DashboardDir = "$HOME\.gemini\dashboard"
Write-Host "🚀 Démarrage du Dashboard Novahiz sur http://localhost:3456 ..." -ForegroundColor Cyan
Set-Location $DashboardDir
npm run dev
