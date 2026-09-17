Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Split-Path -Parent $PSScriptRoot
$InventoryPath = Join-Path $RepoRoot 'app\data\inventory.json'
$MetadataPath = Join-Path $RepoRoot 'app\data\inventory-meta.json'
$ImporterPath = Join-Path $RepoRoot 'scripts\inventory-importer.mjs'
$script:SelectedFile = $null
$script:Preview = $null

function Find-Executable {
    param([string]$Name, [string]$Fallback)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    if (Test-Path -LiteralPath $Fallback) { return $Fallback }
    return $null
}

$Node = Find-Executable 'node.exe' (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
$Git = Find-Executable 'git.exe' (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe')
$Npm = Find-Executable 'npm.cmd' (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\npm.cmd')

function Invoke-CommandLine {
    param([string]$Executable, [string[]]$Arguments)
    Push-Location $RepoRoot
    try {
        $output = & $Executable @Arguments 2>&1 | Out-String
        return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = $output.Trim() }
    }
    finally { Pop-Location }
}

function Format-Currency([double]$Value) {
    return $Value.ToString('C2', [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'))
}

function Preview-Lines($Items, [int]$Limit = 8) {
    if (-not $Items -or $Items.Count -eq 0) { return @('  Nenhum') }
    $lines = @($Items | Select-Object -First $Limit | ForEach-Object { "  - $($_.product) | lote $($_.lot)" })
    if ($Items.Count -gt $Limit) { $lines += "  - ... e mais $($Items.Count - $Limit)" }
    return $lines
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Atualizador de Estoque - AgroConfiança'
$form.Size = New-Object System.Drawing.Size(760, 610)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 248, 242)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Atualizar Vencimento de Produtos'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18)
$title.ForeColor = [System.Drawing.Color]::FromArgb(13, 98, 42)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(28, 22)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Selecione a nova planilha, confira as mudanças e publique no site.'
$subtitle.AutoSize = $true
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(80, 90, 82)
$subtitle.Location = New-Object System.Drawing.Point(31, 62)
$form.Controls.Add($subtitle)

$selectButton = New-Object System.Windows.Forms.Button
$selectButton.Text = '1. Selecionar planilha e analisar'
$selectButton.Size = New-Object System.Drawing.Size(285, 42)
$selectButton.Location = New-Object System.Drawing.Point(32, 100)
$selectButton.BackColor = [System.Drawing.Color]::FromArgb(13, 98, 42)
$selectButton.ForeColor = [System.Drawing.Color]::White
$selectButton.FlatStyle = 'Flat'
$selectButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($selectButton)

$publishButton = New-Object System.Windows.Forms.Button
$publishButton.Text = '2. Confirmar e publicar'
$publishButton.Size = New-Object System.Drawing.Size(230, 42)
$publishButton.Location = New-Object System.Drawing.Point(330, 100)
$publishButton.BackColor = [System.Drawing.Color]::FromArgb(165, 205, 57)
$publishButton.ForeColor = [System.Drawing.Color]::FromArgb(9, 65, 28)
$publishButton.FlatStyle = 'Flat'
$publishButton.FlatAppearance.BorderSize = 0
$publishButton.Enabled = $false
$form.Controls.Add($publishButton)

$siteButton = New-Object System.Windows.Forms.Button
$siteButton.Text = 'Abrir o site'
$siteButton.Size = New-Object System.Drawing.Size(140, 42)
$siteButton.Location = New-Object System.Drawing.Point(573, 100)
$siteButton.Enabled = $false
$form.Controls.Add($siteButton)

$summary = New-Object System.Windows.Forms.TextBox
$summary.Multiline = $true
$summary.ReadOnly = $true
$summary.ScrollBars = 'Vertical'
$summary.WordWrap = $true
$summary.Font = New-Object System.Drawing.Font('Consolas', 10)
$summary.BackColor = [System.Drawing.Color]::White
$summary.BorderStyle = 'FixedSingle'
$summary.Location = New-Object System.Drawing.Point(32, 160)
$summary.Size = New-Object System.Drawing.Size(681, 342)
$summary.Text = "Nenhuma planilha selecionada.`r`n`r`nO estoque atual só será substituído depois da sua confirmação."
$form.Controls.Add($summary)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Pronto para analisar.'
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(681, 42)
$status.Location = New-Object System.Drawing.Point(32, 520)
$status.ForeColor = [System.Drawing.Color]::FromArgb(80, 90, 82)
$form.Controls.Add($status)

function Set-Busy([string]$Message, [bool]$Busy) {
    $status.Text = $Message
    $selectButton.Enabled = -not $Busy
    $hasChanges = $script:Preview -and $script:Preview.hasChanges
    $publishButton.Enabled = (-not $Busy) -and $hasChanges
    $form.UseWaitCursor = $Busy
    [System.Windows.Forms.Application]::DoEvents()
}

$selectButton.Add_Click({
    if (-not $Node -or -not $Git -or -not $Npm) {
        [System.Windows.Forms.MessageBox]::Show('Não encontrei Node.js, npm ou Git neste computador. Abra esta tarefa no Codex para concluir a configuração.', 'Dependência ausente', 'OK', 'Error') | Out-Null
        return
    }
    $dirty = Invoke-CommandLine $Git @('status', '--porcelain')
    if ($dirty.ExitCode -ne 0 -or $dirty.Output) {
        [System.Windows.Forms.MessageBox]::Show("O projeto possui alterações pendentes. Para proteger seus arquivos, a atualização foi interrompida.`r`n`r`n$($dirty.Output)", 'Projeto com alterações', 'OK', 'Warning') | Out-Null
        return
    }

    # Envia automaticamente qualquer publicação que tenha ficado pendente por falta de conexão.
    $pendingPush = Invoke-CommandLine $Git @('push', 'github', 'main')
    if ($pendingPush.ExitCode -ne 0) {
        $status.Text = 'Sem conexão com o GitHub no momento. A análise pode continuar, mas a publicação precisará de internet.'
    }

    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Selecione a nova planilha de estoque'
    $dialog.Filter = 'Planilhas do Excel (*.xlsx)|*.xlsx'
    $dialog.InitialDirectory = Split-Path -Parent $RepoRoot
    if ($dialog.ShowDialog() -ne 'OK') { return }

    $script:SelectedFile = $dialog.FileName
    $previewPath = Join-Path ([System.IO.Path]::GetTempPath()) ("agroconfianca-preview-{0}.json" -f [guid]::NewGuid())
    Set-Busy 'Validando a planilha e comparando os lotes...' $true
    $result = Invoke-CommandLine $Node @($ImporterPath, 'preview', '--file', $script:SelectedFile, '--output', $previewPath, '--inventory', $InventoryPath, '--metadata', $MetadataPath)
    if ($result.ExitCode -ne 0) {
        Set-Busy 'A planilha não pôde ser analisada.' $false
        [System.Windows.Forms.MessageBox]::Show($result.Output, 'Erro na planilha', 'OK', 'Error') | Out-Null
        return
    }
    try { $script:Preview = Get-Content -LiteralPath $previewPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    finally { Remove-Item -LiteralPath $previewPath -Force -ErrorAction SilentlyContinue }

    $changedAfter = @($script:Preview.changed | ForEach-Object { $_.after })
    $summaryLines = @(
        'ARQUIVO SELECIONADO'
        "  $($script:Preview.source.fileName)"
        "  Aba: $($script:Preview.source.sheet) | $($script:Preview.counts.next) lotes válidos"
        ''
        'RESUMO DAS ALTERAÇÕES'
        ('  Permanecem iguais : {0}' -f $script:Preview.counts.unchanged)
        ('  Novos             : {0}' -f $script:Preview.counts.added)
        ('  Alterados         : {0}' -f $script:Preview.counts.changed)
        ('  Removidos         : {0}' -f $script:Preview.counts.removed)
        ''
        'VALOR TOTAL EM ESTOQUE'
        ('  Antes : {0}' -f (Format-Currency $script:Preview.totals.current))
        ('  Depois: {0}' -f (Format-Currency $script:Preview.totals.next))
        ''
        ('DATA DA ATUALIZAÇÃO NO SITE: {0}' -f ([datetime]::ParseExact($script:Preview.lastUpdated.next, 'yyyy-MM-dd', $null).ToString('dd/MM/yyyy')))
    )
    if ($script:Preview.warnings.Count) {
        $summaryLines += @('', 'ATENÇÃO')
        $summaryLines += @($script:Preview.warnings | ForEach-Object { "  - $_" })
    }
    $summaryLines += @('', 'NOVOS')
    $summaryLines += @(Preview-Lines @($script:Preview.added))
    $summaryLines += @('', 'ALTERADOS')
    $summaryLines += @(Preview-Lines $changedAfter)
    $summaryLines += @('', 'REMOVIDOS')
    $summaryLines += @(Preview-Lines @($script:Preview.removed))
    $summary.Text = $summaryLines -join [Environment]::NewLine
    Set-Busy 'Análise concluída. Confira o resumo antes de publicar.' $false
})

$publishButton.Add_Click({
    $answer = [System.Windows.Forms.MessageBox]::Show("Confirmar a substituição do estoque?`r`n`r`nO site passará a usar somente os $($script:Preview.counts.next) lotes desta planilha. O histórico anterior continuará recuperável no GitHub.", 'Confirmar atualização', 'YesNo', 'Question')
    if ($answer -ne 'Yes') { return }

    $backupPath = Join-Path ([System.IO.Path]::GetTempPath()) ("inventory-backup-{0}.json" -f [guid]::NewGuid())
    $metadataBackupPath = Join-Path ([System.IO.Path]::GetTempPath()) ("inventory-meta-backup-{0}.json" -f [guid]::NewGuid())
    $applyPath = Join-Path ([System.IO.Path]::GetTempPath()) ("agroconfianca-apply-{0}.json" -f [guid]::NewGuid())
    Copy-Item -LiteralPath $InventoryPath -Destination $backupPath -Force
    Copy-Item -LiteralPath $MetadataPath -Destination $metadataBackupPath -Force
    $committed = $false
    try {
        Set-Busy 'Aplicando os novos dados...' $true
        $apply = Invoke-CommandLine $Node @($ImporterPath, 'apply', '--file', $script:SelectedFile, '--output', $applyPath, '--inventory', $InventoryPath, '--metadata', $MetadataPath, '--expected-sha256', $script:Preview.source.sha256)
        if ($apply.ExitCode -ne 0) { throw $apply.Output }
        Set-Busy 'Testando o site antes de publicar...' $true
        $build = Invoke-CommandLine $Npm @('run', 'build:pages')
        if ($build.ExitCode -ne 0) { throw "O teste do site falhou.`r`n$($build.Output)" }
        Set-Busy 'Registrando a atualização no GitHub...' $true
        $add = Invoke-CommandLine $Git @('add', '--', 'app/data/inventory.json', 'app/data/inventory-meta.json')
        if ($add.ExitCode -ne 0) { throw $add.Output }
        $commit = Invoke-CommandLine $Git @('commit', '-m', "Atualiza estoque pela planilha em $(Get-Date -Format 'yyyy-MM-dd')")
        if ($commit.ExitCode -ne 0) { throw $commit.Output }
        $committed = $true
        Set-Busy 'Enviando ao GitHub Pages...' $true
        $push = Invoke-CommandLine $Git @('push', 'github', 'main')
        if ($push.ExitCode -ne 0) { throw "Os dados foram registrados, mas o envio ao GitHub falhou.`r`n$($push.Output)" }
        $status.Text = 'Publicado. O GitHub normalmente atualiza a página em 1 a 3 minutos.'
        $summary.AppendText("`r`n`r`nPUBLICAÇÃO CONCLUÍDA`r`nA página está sendo atualizada automaticamente pelo GitHub Pages.")
        $siteButton.Enabled = $true
        $publishButton.Enabled = $false
        [System.Windows.Forms.MessageBox]::Show('Estoque atualizado e enviado ao GitHub. A página pública costuma refletir a alteração em 1 a 3 minutos.', 'Atualização concluída', 'OK', 'Information') | Out-Null
    }
    catch {
        if (-not $committed) {
            Copy-Item -LiteralPath $backupPath -Destination $InventoryPath -Force
            Copy-Item -LiteralPath $metadataBackupPath -Destination $MetadataPath -Force
            Invoke-CommandLine $Git @('restore', '--staged', '--', 'app/data/inventory.json', 'app/data/inventory-meta.json') | Out-Null
            $status.Text = 'A atualização não foi publicada. O estoque anterior foi restaurado.'
        }
        else {
            $status.Text = 'Os dados foram salvos neste computador, mas o envio ficou pendente. Abra o atualizador novamente quando a conexão voltar.'
        }
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Falha na atualização', 'OK', 'Error') | Out-Null
    }
    finally {
        Remove-Item -LiteralPath $backupPath, $metadataBackupPath, $applyPath -Force -ErrorAction SilentlyContinue
        $form.UseWaitCursor = $false
        $selectButton.Enabled = $true
    }
})

$siteButton.Add_Click({ Start-Process 'https://agroconfia.github.io/vencimento-de-produtos/' })
[void]$form.ShowDialog()
