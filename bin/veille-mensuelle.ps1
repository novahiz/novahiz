# Veille mensuelle Novahiz — vérifie l'état de la chaîne et journalise.
# Déclenchée par clepsydre (tâche "veille-mensuelle"). Sortie dans logs/veille/.
$ErrorActionPreference = "Continue"
$novahiz = "C:\Users\Tawhid\.config\novahiz"
$logDir = Join-Path $novahiz "logs\veille"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log = Join-Path $logDir ("veille-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

"==== Veille Novahiz du $(Get-Date -Format 'yyyy-MM-dd HH:mm') ====" | Out-File $log -Encoding utf8

"`n---- novahiz doctor ----" | Out-File $log -Append -Encoding utf8
node (Join-Path $novahiz "bin\novahiz.mjs") doctor 2>&1 | Out-File $log -Append -Encoding utf8

"`n---- impeccable : version + mises à jour skills ----" | Out-File $log -Append -Encoding utf8
impeccable --version 2>&1 | Out-File $log -Append -Encoding utf8
impeccable check 2>&1 | Out-File $log -Append -Encoding utf8

"`n---- npm : paquets globaux obsolètes ----" | Out-File $log -Append -Encoding utf8
npm outdated -g 2>&1 | Out-File $log -Append -Encoding utf8

"`n---- novahiz : version installée vs npm ----" | Out-File $log -Append -Encoding utf8
node (Join-Path $novahiz "bin\novahiz.mjs") upgrade 2>&1 | Out-File $log -Append -Encoding utf8

"`n==== Fin de veille ====" | Out-File $log -Append -Encoding utf8
