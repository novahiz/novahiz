---
name: novahiz-security
description: |
  novahiz-security : audit de sécurité complet avec OWASP Top 10, CWE Top 25, patterns
  dangereux, injection, XSS, auth bypass. Use when reviewing code for security vulnerabilities,
  hardening authentication, validating input handling, or generating security reports.
license: MIT
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-security

Audit de sécurité en trois temps : scan des patterns dangereux, analyse OWASP et CWE, puis vérifications propres à chaque langage.

## Matrice de détection

### OWASP Top 10 (2021)

| ID | Catégorie | Détection |
|----|-----------|-----------|
| A01 | Broken Access Control | RBAC, contrôle horizontal et vertical |
| A02 | Cryptographic Failures | Algorithmes faibles, clés en dur |
| A03 | Injection | SQL, NoSQL, OS, LDAP, XPath |
| A04 | Insecure Design | Patterns architecturaux dangereux |
| A05 | Security Misconfiguration | Defaults, headers, CORS |
| A06 | Vulnerable Components | Dépendances obsolètes |
| A07 | Auth Failures | Session fixation, brute force |
| A08 | Data Integrity Failures | Deserialization non signée |
| A09 | Logging Failures | Données sensibles dans les logs |
| A10 | SSRF | Requêtes serveur sans validation |

### CWE Top 25 (2024)

| ID | Faiblesse | Signature de détection |
|----|-----------|------------------------|
| CWE-79 | XSS | `innerHTML`, `dangerouslySetInnerHTML`, `document.write` |
| CWE-89 | SQL Injection | Concaténation SQL, format strings |
| CWE-416 | Use After Free | Pointeurs, mémoire manuelle (C/C++) |
| CWE-787 | Out-of-bounds Write | Débordement de buffer |
| CWE-78 | Command Injection | `exec()`, `system()`, `os.popen()` |
| CWE-190 | Integer Overflow | Arithmétique non vérifiée |
| CWE-502 | Deserialization | `pickle.loads()`, `yaml.load()` |
| CWE-200 | Info Exposure | Logs sensibles, stack traces |
| CWE-287 | Auth Bypass | Session non vérifiée |
| CWE-476 | NULL Pointer | Déréférencement sans garde |

## Patterns par langage

### JavaScript et TypeScript

```javascript
// Command injection
exec(`rm -rf ${userInput}`)
child_process.execSync(userCommand)

// Code injection
new Function(userInput)()
eval(userInput)

// XSS
element.innerHTML = userInput
document.write(userInput)
element.outerHTML = userInput

// Prototype pollution
Object.assign(target, userInput)
_.merge(target, userInput)
```

### Python

```python
# Command injection
os.system(f"ping {host}")
subprocess.call(f"ls {path}", shell=True)
os.popen(userCommand)

# Deserialization
pickle.loads(data)
yaml.load(data)  # sans Loader=SafeLoader
eval(userInput)
exec(userInput)

# SQL injection
cursor.execute(f"SELECT * FROM users WHERE id={user_id}")
cursor.execute("SELECT * FROM users WHERE id=%s" % user_id)

# Path traversal
open(f"/data/{filename}")
```

### Go

```go
// Command injection
exec.Command("sh", "-c", userInput)
os/exec.Command(userCommand)

// SQL injection
db.Query("SELECT * FROM users WHERE id=" + userId)

// Path traversal
os.Open("/data/" + filename)
```

### Rust

```rust
// Command injection
Command::new("sh").arg("-c").arg(&user_input)

// unwrap sans contexte : panic possible
let value = risky_operation().unwrap();
```

### Java

```java
// SQL injection
Statement stmt = conn.createStatement();
stmt.executeQuery("SELECT * FROM users WHERE id=" + userId);

// Deserialization
ObjectInputStream ois = new ObjectInputStream(input);
Object obj = ois.readObject();

// Path traversal
new File("/data/" + filename)
```

## Checklist

### Authentification

- [ ] Aucun mot de passe en dur
- [ ] Hash bcrypt ou argon2, jamais MD5 ni SHA1
- [ ] Rate limiting sur login
- [ ] Lockout après échecs répétés
- [ ] Timeout de session configuré
- [ ] MFA disponible

### Autorisation

- [ ] RBAC vérifié sur chaque endpoint
- [ ] Propriétaire de la ressource validé
- [ ] Pas d'IDOR
- [ ] Validation côté serveur uniquement

### Input validation

- [ ] Validation de schéma (Zod, Joi, Pydantic)
- [ ] Sanitization HTML si le contenu est rendu
- [ ] Limites de taille
- [ ] Whitelist plutôt que blacklist

### Données sensibles

- [ ] Secrets en variables d'environnement
- [ ] Chiffrement au repos
- [ ] TLS en transit
- [ ] Aucune PII dans les logs

### Configuration

- [ ] CSP, HSTS, X-Frame-Options
- [ ] CORS restrictif
- [ ] Debug désactivé en production
- [ ] Erreurs génériques sans stack trace

## Matrice de risque

| Risque | Impact | Exploitabilité | Score |
|--------|--------|----------------|-------|
| SQL Injection | Critique | Facile | 9.8 |
| Command Injection | Critique | Moyen | 9.0 |
| Auth Bypass | Critique | Moyen | 8.5 |
| XSS stocké | Élevé | Facile | 8.0 |
| Deserialization | Critique | Difficile | 7.5 |
| Path Traversal | Élevé | Facile | 7.0 |
| Information Disclosure | Moyen | Facile | 5.0 |

## Workflow d'audit

### 1. Scan

```bash
# Secrets
grep -rn "(password|secret|api_key|token)\s*=\s*['\"]" --include="*.{ts,js,py,go,rs,java}"

# Injection
grep -rn "(exec|system|popen|shell_exec)\s*\(" --include="*.{ts,js,py,go,rs,java}"

# XSS
grep -rn "(innerHTML|dangerouslySetInnerHTML|document\.write)" --include="*.{ts,tsx,js,jsx}"
```

### 2. Analyse contextuelle

Pour chaque finding : identifier la source, tracer le flux jusqu'au puits (DB, HTML, shell), vérifier validation et sanitization, puis juger l'exploitabilité.

### 3. Rapport

```markdown
# Security audit report

## Summary
- Critical: 2
- High: 3
- Medium: 5
- Low: 8

## Critical findings

### SEC-001: SQL injection in user.ts:42
- **CWE:** CWE-89
- **OWASP:** A03:2021
- **Evidence:** `cursor.execute(f"SELECT * FROM users WHERE id={userId}")`
- **Fix:** requête paramétrée
  `cursor.execute("SELECT * FROM users WHERE id=%s", (userId,))`
```

## Note sur les fichiers

Cette skill n'a pas de dossier `references/`. Les matrices et checklists vivent dans ce fichier. Ne pas référencer un chemin absent du disque.
