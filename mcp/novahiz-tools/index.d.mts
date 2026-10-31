/**
 * Déclarations pour le serveur MCP `novahiz-tools`, consommé par les tests.
 *
 * Le fichier est un `.mjs` sans types ; sans ce compagnon `.d.mts`, la suite
 * de tests ne peut pas vérifier la cohérence entre l'enum du schéma, la
 * description et la liste d'actions acceptée par le handler (NX-39).
 */

export declare const TASK_ACTIONS: readonly string[];

export declare const TASK_TOOL: {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: {
      action: { type: string; enum: readonly string[]; description: string };
      [key: string]: unknown;
    };
    required: string[];
  };
};

export declare function negotiateProtocol(requested: unknown): unknown;
