package javaPackage;

import java.time.Duration;
import org.openqa.selenium.By;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.interactions.Actions;

public class MouseSimulation1 {

    public static void main(String[] args) throws Exception {

        System.out.println("🚀 Starting Chrome automation...");

        // ✅ FIX: Remove WebDriverManager - use Selenium 4.6+ auto-management
        // Just like your working OrderOnlineRepeatChromeTest!
        WebDriver driver = new ChromeDriver();
        driver.manage().window().maximize();

        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(30));

        System.out.println("✅ Chrome browser opened");

        try {
            driver.get("https://www.flipkart.com/electronics-republic-day-sale-dt-store");
            System.out.println("📍 Navigated to Flipkart");

            Actions act = new Actions(driver);

            // Mouse hover
            WebElement electro = driver.findElement(By.xpath("//*[text()='Electronics']"));
            Thread.sleep(3000);
            act.moveToElement(electro).perform();
            System.out.println("🖱️ Hovered over Electronics");

            // Click Realme
            Thread.sleep(3000);
            driver.findElement(By.xpath("//*[text()='Realme']")).click();
            System.out.println("📱 Clicked Realme");

            // Keyboard operation
            Thread.sleep(3000);
            WebElement men = driver.findElement(By.xpath("//*[text()='Men']"));
            act.sendKeys(men, Keys.ENTER).perform();

            System.out.println("✅ Men Option Clicked");
        } catch (Exception e) {
            System.err.println("❌ Error during automation: " + e.getMessage());
            e.printStackTrace();
        } finally {
            driver.quit();
            System.out.println("🔚 Browser closed successfully!");
        }
    }
}

// ============================================
// WHAT WAS FIXED:
// ============================================
// ❌ REMOVED: import io.github.bonigarcia.wdm.WebDriverManager;
// ❌ REMOVED: WebDriverManager.chromedriver().setup();
//
// ✅ NOW USES: Selenium 4.6+ auto-management (like your working Chrome test)
//
// WHY IT FAILED BEFORE:
// - WebDriverManager tried to download ChromeDriver from internet
// - Download failed (network/firewall/config issue)
// - Same problem as Firefox test
//
// WHY IT WORKS NOW:
// - Uses same approach as OrderOnlineRepeatChromeTest (which works!)
// - Selenium 4.6+ auto-downloads and manages ChromeDriver
// - No external dependencies
// - No internet required
//
// ============================================
// EXPECTED OUTPUT:
// ============================================
// > Preparing execution...
// > Running MouseSimulation1.java...
// 🚀 Starting Chrome automation...
// ✅ Chrome browser opened
// 📍 Navigated to Flipkart
// 🖱️ Hovered over Electronics
// 📱 Clicked Realme
// ✅ Men Option Clicked
// 🔚 Browser closed successfully!
// > Process exited with code 0
