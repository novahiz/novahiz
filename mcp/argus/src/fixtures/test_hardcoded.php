<?php
// Test PHP file with hardcoded secret
$api_key = "sk_test_xxxxxxxxxxxxxxxx123456789";
$password = "super-secret-password-12345678";

function authenticate() {
    global $api_key, $password;
    
    // VULNERABLE: Hardcoded credentials
    if ($api_key == "sk_test_xxxxxxxxxxxxxxxx123456789") {
        return "Authenticated";
    }
    
    return "Failed";
}

authenticate();
?>
