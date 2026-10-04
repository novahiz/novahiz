#!/bin/bash
# Test shell script with command injection vulnerability

username="admin"
password="secret123"

# VULNERABLE: Command injection via user input
user_input="test; rm -rf /tmp/*"

system("echo "Username: $username, Password: $password, Input: $user_input"")

# Additional vulnerable command
command="ls -la /"
if [ "$user_input" = "$command" ]; then
    echo "Command executed"
fi
