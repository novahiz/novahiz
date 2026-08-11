import sys
import json

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({}))
            return
            
        payload = json.loads(input_data)
        
        # Injection d'un rappel système invisible pour l'utilisateur
        output = {
            "injectSteps": [
                {
                    "ephemeralMessage": "🛡️ SYSTEM GUARANTEE : N'oubliez pas de consulter l'index `skills_inventory.md` et les catégories appropriées avant toute nouvelle tâche."
                }
            ]
        }
        
        print(json.dumps(output))
    except Exception as e:
        # En cas d'erreur, on retourne un objet vide pour ne pas bloquer l'agent
        print(json.dumps({}))

if __name__ == "__main__":
    main()
