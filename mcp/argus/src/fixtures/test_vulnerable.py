# Test Python file with SQL injection vulnerability
import sqlite3

def get_user(user_id):
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    
    # VULNERABLE: Direct string concatenation
    query = f"SELECT * FROM users WHERE id = {user_id}"
    cursor.execute(query)
    
    results = cursor.fetchall()
    conn.close()
    return results

# Test with user input
test_id = "1 OR 1=1; --"
users = get_user(test_id)
print(users)
