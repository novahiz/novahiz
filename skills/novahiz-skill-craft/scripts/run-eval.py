#!/usr/bin/env python3
import sys
def run(prompt_path):
    with open(prompt_path, "r") as f:
        prompt = f.read()
    print(f"Exécution du prompt depuis {prompt_path}")
    print(f"Prompt: {prompt[:200]}...")
if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "evals/test-prompt.md"
    run(path)
