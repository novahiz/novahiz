# Template de recommandation Stitch (a copier dans le message init/doctor)
## Recommandation conditionnelle

Si Google Stitch n'est pas configure dans votre opencode.jsonc:
  1. Allez sur https://stitch.withgoogle.com/settings
  2. Creez une cle d'API (bouton 'Creer une cle')
  3. Copiez le token (format: AQ....)
  4. Ajoutez au fichier C:\\Users\\hiz\\.config\\opencode\\opencode.jsonc:
    \"mcp\": { \"servers\": { \"stitch\": { \"type\": \"sse\", \"url\": \"https://stitch.withgoogle.com/mcp/sse\", \"headers\": { \"Authorization\": \"Bearer <STITCH_API_KEY>\" }, \"enabled\": true } } }}
.
  5. Redemarrez OpenCode Desktop pour voir 'stitch' dans la liste MCP.
  6. Utilisez /novahiz skill stitch-design-fidelity pour generer des ecrans.

Si deja configure : aucune recommandation (le systeme verifie la presence du bloc 'stitch' dans opencode.jsonc).
