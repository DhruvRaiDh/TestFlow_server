# Download WebDriverManager Dependencies
# This script downloads all missing JARs needed for WebDriverManager to work

$libDir = "F:\Projects\Test-flow\Backend\lib\java"

Write-Host "📦 Downloading WebDriverManager Dependencies..." -ForegroundColor Cyan
Write-Host "Target directory: $libDir`n" -ForegroundColor Gray

$jars = @(
    @{
        name = "commons-io-2.15.1.jar"
        url = "https://repo1.maven.org/maven2/commons-io/commons-io/2.15.1/commons-io-2.15.1.jar"
        desc = "Apache Commons IO - File operations"
    },
    @{
        name = "httpclient5-5.3.jar"
        url = "https://repo1.maven.org/maven2/org/apache/httpcomponents/client5/httpclient5/5.3/httpclient5-5.3.jar"
        desc = "Apache HttpClient 5 - HTTP requests"
    },
    @{
        name = "httpcore5-5.2.4.jar"
        url = "https://repo1.maven.org/maven2/org/apache/httpcomponents/core5/httpcore5/5.2.4/httpcore5-5.2.4.jar"
        desc = "Apache HttpCore 5 - HTTP core"
    },
    @{
        name = "httpcore5-h2-5.2.4.jar"
        url = "https://repo1.maven.org/maven2/org/apache/httpcomponents/core5/httpcore5-h2/5.2.4/httpcore5-h2-5.2.4.jar"
        desc = "Apache HttpCore 5 H2 - HTTP/2 support"
    },
    @{
        name = "commons-compress-1.25.0.jar"
        url = "https://repo1.maven.org/maven2/org/apache/commons/commons-compress/1.25.0/commons-compress-1.25.0.jar"
        desc = "Apache Commons Compress - ZIP/TAR extraction"
    },
    @{
        name = "jsoup-1.17.2.jar"
        url = "https://repo1.maven.org/maven2/org/jsoup/jsoup/1.17.2/jsoup-1.17.2.jar"
        desc = "Jsoup - HTML parsing"
    },
    @{
        name = "slf4j-simple-2.0.9.jar"
        url = "https://repo1.maven.org/maven2/org/slf4j/slf4j-simple/2.0.9/slf4j-simple-2.0.9.jar"
        desc = "SLF4J Simple - Logging implementation"
    }
)

$successCount = 0
$failCount = 0

foreach ($jar in $jars) {
    $output = Join-Path $libDir $jar.name
    
    # Check if already exists
    if (Test-Path $output) {
        Write-Host "⏭️  Skipping $($jar.name) (already exists)" -ForegroundColor Yellow
        $successCount++
        continue
    }
    
    Write-Host "📥 Downloading: $($jar.name)" -ForegroundColor White
    Write-Host "   $($jar.desc)" -ForegroundColor Gray
    
    try {
        Invoke-WebRequest -Uri $jar.url -OutFile $output -ErrorAction Stop
        $size = (Get-Item $output).Length / 1KB
        Write-Host "   ✅ Downloaded: $([math]::Round($size, 2)) KB`n" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host "   ❌ Failed: $($_.Exception.Message)`n" -ForegroundColor Red
        $failCount++
    }
}

Write-Host "`n" + ("="*60) -ForegroundColor Cyan
Write-Host "📊 Download Summary:" -ForegroundColor Cyan
Write-Host "   ✅ Successful: $successCount" -ForegroundColor Green
Write-Host "   ❌ Failed: $failCount" -ForegroundColor Red

if ($failCount -eq 0) {
    Write-Host "`n🎉 All dependencies downloaded successfully!" -ForegroundColor Green
    Write-Host "   WebDriverManager is now ready to use in Dev Studio IDE!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Some downloads failed. Please check your internet connection." -ForegroundColor Yellow
}

Write-Host "`n📋 Listing all JARs in lib/java:" -ForegroundColor Cyan
Get-ChildItem $libDir -Filter *.jar | Select-Object Name, @{Name="Size (KB)";Expression={[math]::Round($_.Length/1KB,2)}} | Format-Table -AutoSize
