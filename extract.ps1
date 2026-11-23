Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web.Extensions

$sourcePath = "$HOME\Downloads\All Renewal Database.xlsm"
$jsonPath = "c:\Users\Admin\OneDrive - Safetynet Innovations Private Limited\Desktop\HS\companies.json"
$jsPath = "c:\Users\Admin\OneDrive - Safetynet Innovations Private Limited\Desktop\HS\companies_data.js"
$csvPath = "c:\Users\Admin\OneDrive - Safetynet Innovations Private Limited\Desktop\HS\companies.csv"

Write-Host "Opening workbook: $sourcePath"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$zip = [System.IO.Compression.ZipFile]::OpenRead($sourcePath)

Write-Host "Reading shared strings..."
$ssEntry = $zip.GetEntry('xl/sharedStrings.xml')
$ssReader = [System.Xml.XmlReader]::Create($ssEntry.Open())
$strings = New-Object System.Collections.Generic.List[string]

while ($ssReader.Read()) {
    if ($ssReader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $ssReader.Name -eq 'si') {
        $sub = $ssReader.ReadSubtree()
        $txt = [System.Text.StringBuilder]::new()
        while ($sub.Read()) {
            if ($sub.NodeType -eq [System.Xml.XmlNodeType]::Element -and $sub.Name -eq 't') {
                [void]$txt.Append($sub.ReadInnerXml())
            }
        }
        $strings.Add($txt.ToString())
    }
}
$ssReader.Close()
Write-Host "Loaded $($strings.Count) shared strings in $($sw.ElapsedMilliseconds) ms"

$s1Entry = $zip.GetEntry('xl/worksheets/sheet1.xml')
$reader = [System.Xml.XmlReader]::Create($s1Entry.Open())

$baseDate = [DateTime]::new(1899, 12, 30)

$jsWriter = New-Object System.IO.StreamWriter($jsPath, $false, [System.Text.Encoding]::UTF8)
$jsonWriter = New-Object System.IO.StreamWriter($jsonPath, $false, [System.Text.Encoding]::UTF8)
$csvWriter = New-Object System.IO.StreamWriter($csvPath, $false, [System.Text.Encoding]::UTF8)

$jsWriter.WriteLine("window.COMPANIES_DATA = [")
$jsonWriter.WriteLine("[")
$csvWriter.WriteLine('"id","name","date","month","strength","size","location","premium","bd","contact","designation","email","phone","remarks","broker","insurer","src"')

$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 2147483647

function Escape-Csv([string]$v) {
    if ([string]::IsNullOrEmpty($v)) { return '""' }
    return '"' + ($v -replace '"', '""') + '"'
}

$count = 0
$first = $true

while ($reader.Read()) {
    if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.Name -eq 'row') {
        $rNum = $reader.GetAttribute('r')
        if ($rNum -eq '1') { continue }

        $rowSub = $reader.ReadSubtree()

        $src = ""; $name = ""; $date = ""; $month = ""; $strength = ""; $size = ""
        $loc = ""; $prem = ""; $bd = ""; $contact = ""; $desig = ""; $email = ""
        $phone = ""; $remarks = ""; $broker = ""; $insurer = ""

        while ($rowSub.Read()) {
            if ($rowSub.NodeType -eq [System.Xml.XmlNodeType]::Element -and $rowSub.Name -eq 'c') {
                $cellRef = $rowSub.GetAttribute('r')
                $type = $rowSub.GetAttribute('t')

                $col = $cellRef -replace '[0-9]', ''

                $valSub = $rowSub.ReadSubtree()
                $val = ''
                while ($valSub.Read()) {
                    if ($valSub.NodeType -eq [System.Xml.XmlNodeType]::Element -and $valSub.Name -eq 'v') {
                        $raw = $valSub.ReadInnerXml()
                        if ($type -eq 's') {
                            $idx = [int]$raw
                            if ($idx -lt $strings.Count) { $val = $strings[$idx] }
                        } else {
                            $val = $raw
                        }
                    }
                }

                switch ($col) {
                    'A' { $src = $val.Trim() }
                    'B' { $name = $val.Trim() }
                    'C' {
                        $d = 0.0
                        if ([double]::TryParse($val, [ref]$d) -and $d -gt 30000 -and $d -lt 60000) {
                            $date = $baseDate.AddDays($d).ToString('yyyy-MM-dd')
                        } else {
                            $date = $val.Trim()
                        }
                    }
                    'D' { $month = $val.Trim() }
                    'E' { $strength = $val.Trim() }
                    'F' { $size = $val.Trim() }
                    'G' { $loc = $val.Trim() }
                    'H' { $prem = $val.Trim() }
                    'I' { $bd = $val.Trim() }
                    'J' { $contact = $val.Trim() }
                    'K' { $desig = $val.Trim() }
                    'L' { $email = $val.Trim() }
                    'M' { $phone = $val.Trim() }
                    'N' { $remarks = $val.Trim() }
                    'O' { $broker = $val.Trim() }
                    'P' { $insurer = $val.Trim() }
                }
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $count++
            if (-not $first) {
                $jsWriter.WriteLine(",")
                $jsonWriter.WriteLine(",")
            }
            $first = $false

            $item = @{
                id = $count
                name = $name
                src = $src
                date = $date
                month = $month
                strength = $strength
                size = $size
                location = $loc
                premium = $prem
                bd = $bd
                contact = $contact
                designation = $desig
                email = $email
                phone = $phone
                remarks = $remarks
                broker = $broker
                insurer = $insurer
            }

            $lineJson = $ser.Serialize($item)
            $jsWriter.Write($lineJson)
            $jsonWriter.Write($lineJson)

            $csvLine = "$count,$(Escape-Csv $name),$(Escape-Csv $date),$(Escape-Csv $month),$(Escape-Csv $strength),$(Escape-Csv $size),$(Escape-Csv $loc),$(Escape-Csv $prem),$(Escape-Csv $bd),$(Escape-Csv $contact),$(Escape-Csv $desig),$(Escape-Csv $email),$(Escape-Csv $phone),$(Escape-Csv $remarks),$(Escape-Csv $broker),$(Escape-Csv $insurer),$(Escape-Csv $src)"
            $csvWriter.WriteLine($csvLine)

            if ($count % 5000 -eq 0) {
                Write-Host "Processed $count rows..."
            }
        }
    }
}

$reader.Close()
$zip.Dispose()

$jsWriter.WriteLine()
$jsWriter.WriteLine("];")
$jsWriter.Close()

$jsonWriter.WriteLine()
$jsonWriter.WriteLine("]")
$jsonWriter.Close()

$csvWriter.Close()
$sw.Stop()

Write-Host "Complete! Successfully exported $count companies in $($sw.ElapsedMilliseconds) ms."
