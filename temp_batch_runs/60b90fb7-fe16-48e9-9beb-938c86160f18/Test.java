
public class Static1 {
    int x = 500; // Global (Instance variable) 
    String s = "Hello"; // Global (Instance variable)
    static int y = 100; // static variable

    // --- CRITICAL CHANGE: Added Main Method ---
    public static void main(String[] args) {
        System.out.println("--- Execution Started ---");

        // 1. Call static method directly (No object needed)
        method1();

        // 2. Call non-static method (Requires object instance)
        Static1 obj = new Static1();
        obj.method2();

        // 3. Access variables
        System.out.println("Static y value: " + y);
        System.out.println("Instance x value: " + obj.x);
    }

    // static method
    public static void method1(){
        String x = "Hi"; // Local variable
        System.out.println("Output from method1: " + x);
    }

    // non-static method
    public void method2(){
        int i = 100; // local variable
        System.out.println("Output from method2: " + i);
    }
}