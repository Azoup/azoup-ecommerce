# Copia arquivos mínimos do azoup-ecommerce para o apiconfec (marketplace-ecommerce)

param(

  [Parameter(Mandatory = $true)]

  [string]$Destino

)



$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$Backend = Join-Path $Root "backend"

$DeployPkg = Join-Path $PSScriptRoot "marketplace-ecommerce"



$files = @(

  @{ Src = "routes\marketplaceWebhookRoutes.js"; Dst = "routes\marketplaceWebhookRoutes.js" },

  @{ Src = "lib\supabaseAdmin.js"; Dst = "lib\supabaseAdmin.js" },

  @{ Src = "lib\tokenCrypto.js"; Dst = "lib\tokenCrypto.js" },

  @{ Src = "lib\marketplaceConfig.js"; Dst = "lib\marketplaceConfig.js" },

  @{ Src = "lib\marketplaceIntegration.js"; Dst = "lib\marketplaceIntegration.js" },

  @{ Src = "lib\marketplaceIntegrationRead.js"; Dst = "lib\marketplaceIntegrationRead.js" },

  @{ Src = "lib\marketplaceWebhookAuth.js"; Dst = "lib\marketplaceWebhookAuth.js" },

  @{ Src = "lib\marketplaceWebhookBody.js"; Dst = "lib\marketplaceWebhookBody.js" },

  @{ Src = "lib\marketplaceWebhooks.js"; Dst = "lib\marketplaceWebhooks.js" },

  @{ Src = "lib\estoqueLedger.js"; Dst = "lib\estoqueLedger.js" },

  @{ Src = "lib\nuvemshopClient.js"; Dst = "lib\nuvemshopClient.js" },

  @{ Src = "lib\nuvemshopOrderStatuses.js"; Dst = "lib\nuvemshopOrderStatuses.js" },

  @{ Src = "lib\trayOrderStatuses.js"; Dst = "lib\trayOrderStatuses.js" },

  @{ Src = "lib\marketplaceStockSync.js"; Dst = "lib\marketplaceStockSync.js" },

  @{ Src = "lib\marketplaceOrderSync.js"; Dst = "lib\marketplaceOrderSync.js" },

  @{ Src = "lib\marketplaceProductMap.js"; Dst = "lib\marketplaceProductMap.js" },

  @{ Src = "lib\integracaoEventLog.js"; Dst = "lib\integracaoEventLog.js" },

  @{ Src = "lib\trayConfig.js"; Dst = "lib\trayConfig.js" }

)



New-Item -ItemType Directory -Force -Path $Destino | Out-Null

New-Item -ItemType Directory -Force -Path (Join-Path $Destino "routes") | Out-Null

New-Item -ItemType Directory -Force -Path (Join-Path $Destino "lib") | Out-Null



Copy-Item (Join-Path $DeployPkg "package.json") (Join-Path $Destino "package.json") -Force



foreach ($f in $files) {

  $srcPath = Join-Path $Backend $f.Src

  $dstPath = Join-Path $Destino $f.Dst

  if (-not (Test-Path $srcPath)) {

    Write-Error "Arquivo não encontrado: $srcPath"

    exit 1

  }

  Copy-Item $srcPath $dstPath -Force

  Write-Host "OK $($f.Dst)"

}



Write-Host ""

Write-Host "Copiado para: $Destino"

Write-Host "Próximo passo: deploy/apiconfec/README.md (index.js + .env + registrar webhooks Nuvemshop)"

