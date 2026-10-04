// S3 : l'ingestion réseau, prouvee HORS-LIGNE — le fetch est injecte, le test
// n'ouvre aucune socket. Trois liens de la chaine (llms.txt, README raw,
// sitemap), les deux gardiens (robots.txt et Content-Signal), la cadence par
// origine et le jeton GitHub optionnel sortent d'ici avec leur journal.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import type { CatalogEntry } from "../mcp/novahiz-docs/src/catalog.ts";
import {
  blockedBy,
  createIngester,
  htmlToText,
  isLlmsIndex,
  parseRobots,
  type FetchLike,
  type FetchResponse,
  type LogEntry
} from "../mcp/novahiz-docs/src/ingest.ts";
import { countChunks, openStore, search } from "../mcp/novahiz-docs/src/store.ts";

function fakeResponse(status: number, body: string): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body
  };
}

type Routes = Record<string, FetchResponse>;

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

function makeFetch(routes: Routes): { fetchImpl: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, headers: init?.headers ?? {} });
    return routes[url] ?? fakeResponse(404, "Not Found");
  };
  return { fetchImpl, requests };
}

const WIDGETS: CatalogEntry = {
  id: "widgets",
  name: "Widgets",
  ecosystem: "npm",
  aliases: ["widget"],
  repo: "acme/widgets",
  docsUrl: "https://docs.example.test",
  llmsTxt: "https://docs.example.test/llms.txt"
};

const LICENSE = "https://raw.githubusercontent.com/acme/widgets/HEAD/LICENSE";
const README = "https://raw.githubusercontent.com/acme/widgets/HEAD/README.md";
const ROBOTS = "https://docs.example.test/robots.txt";
const LLMS = "https://docs.example.test/llms.txt";
const SITEMAP = "https://docs.example.test/sitemap.xml";

const MIT = "MIT License\n\nPermission is hereby granted, free of charge.";
const LLMS_BODY = "# Widgets\n\n- [Guide](https://docs.example.test/guide) Widgets API reference\n";

function outcome(log: LogEntry[], step: string): LogEntry | undefined {
  return log.find((entry) => entry.step === step);
}

function baseRoutes(extra: Routes = {}): Routes {
  return {
    [LICENSE]: fakeResponse(200, MIT),
    [ROBOTS]: fakeResponse(404, "no robots"),
    ...extra
  };
}

describe("ingestion — chaîne de replis", () => {
  test("llms.txt present : indexe, licence detectee, citation trouvable", async () => {
    const { fetchImpl } = makeFetch(baseRoutes({ [LLMS]: fakeResponse(200, LLMS_BODY) }));
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(result.indexed, true);
      assert.equal(result.source, "llms.txt");
      assert.ok(result.chunks > 0);
      assert.equal(result.license, "MIT");
      assert.equal(outcome(result.log, "llms.txt")?.outcome, "indexed");

      const hits = search(db, "Widgets");
      assert.ok(hits.length >= 1, "le texte indexe est cherchable");
      assert.equal(hits[0].license, "MIT", "la citation porte la licence du depot");
      assert.equal(hits[0].sourceUrl, LLMS);
      assert.equal(countChunks(db, "widgets"), result.chunks);
    } finally {
      db.close();
    }
  });

  test("llms.txt absent : le repli README raw est demontre", async () => {
    const { fetchImpl } = makeFetch(
      baseRoutes({ [README]: fakeResponse(200, "# Widgets handbook\n\nInstall widgets with the CLI.\n") })
    );
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(result.indexed, true);
      assert.equal(result.source, "readme", "le deuxieme maillon a pris le relais");
      assert.equal(outcome(result.log, "llms.txt")?.outcome, "absent");
      assert.equal(outcome(result.log, "readme")?.outcome, "indexed");
      assert.equal(result.license, "MIT");
    } finally {
      db.close();
    }
  });

  test("llms.txt non exploitable (piege HTML) : signale unusable, on descend", async () => {
    const { fetchImpl } = makeFetch(
      baseRoutes({
        [LLMS]: fakeResponse(200, "<!DOCTYPE html><html><body>Soft 404</body></html>"),
        [README]: fakeResponse(200, "# Widgets\n\nDocumentation fallback.\n")
      })
    );
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(outcome(result.log, "llms.txt")?.outcome, "unusable");
      assert.equal(result.source, "readme");
    } finally {
      db.close();
    }
  });

  test("deuxieme et troisieme liens en 404 : rien indexe, journal complet", async () => {
    const { fetchImpl } = makeFetch(baseRoutes());
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(result.indexed, false);
      assert.equal(result.source, null);
      assert.equal(result.chunks, 0);
      assert.equal(outcome(result.log, "readme")?.outcome, "absent");
      assert.equal(outcome(result.log, "sitemap")?.outcome, "absent");
    } finally {
      db.close();
    }
  });

  test("sitemap : pages memes origines suivies, HTML converti, autres origines filtres", async () => {
    const pageA = "<html><body><h1>Page A</h1><p>alpha passage for search</p></body></html>";
    const pageB = "<html><body><h2>Page B</h2><p>beta passage for search</p></body></html>";
    const { fetchImpl } = makeFetch(
      baseRoutes({
        [SITEMAP]: fakeResponse(
          200,
          "<urlset>" +
            "<url><loc>https://docs.example.test/a</loc></url>" +
            "<url><loc>https://docs.example.test/b</loc></url>" +
            "<url><loc>https://other.test/c</loc></url>" +
            "</urlset>"
        ),
        "https://docs.example.test/a": fakeResponse(200, pageA),
        "https://docs.example.test/b": fakeResponse(200, pageB)
      })
    );
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(result.indexed, true);
      assert.equal(result.source, "sitemap");
      assert.ok(result.chunks >= 2, "les deux pages produisent au moins un passage chacune");
      assert.equal(outcome(result.log, "sitemap")?.detail, "2 pages suivies");
      assert.ok(search(db, "alpha passage").length >= 1, "le HTML converti est indexable");
      assert.ok(search(db, "beta passage").length >= 1);
    } finally {
      db.close();
    }
  });
});

describe("ingestion — les deux gardiens", () => {
  test("robots.txt qui interdit /llms.txt : blocked-robots, jamais de requete sur le chemin", async () => {
    const { fetchImpl, requests } = makeFetch(
      baseRoutes({
        [ROBOTS]: fakeResponse(200, "User-agent: *\nDisallow: /llms.txt\n"),
        [README]: fakeResponse(200, "# Widgets\n\nFallback text.\n")
      })
    );
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      const blocked = outcome(result.log, "llms.txt");
      assert.equal(blocked?.outcome, "blocked-robots");
      assert.equal(blocked?.detail, "Disallow: /llms.txt");
      assert.ok(!requests.some((request) => request.url === LLMS), "aucune requete sur le chemin interdit");
      assert.equal(result.source, "readme", "le repli d'une autre origine reste permis");
    } finally {
      db.close();
    }
  });

  test("Content-Signal ai-input=no : blocked-signal, rien n'est indexe", async () => {
    const { fetchImpl } = makeFetch(
      baseRoutes({ [ROBOTS]: fakeResponse(200, "User-agent: novahiz-docs\nContent-Signal: search=yes, ai-input=no\n") })
    );
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(result.indexed, false);
      const blocked = outcome(result.log, "llms.txt");
      assert.equal(blocked?.outcome, "blocked-signal");
      assert.equal(blocked?.detail, "Content-Signal: ai-input=no");
      assert.equal(countChunks(db), 0, "aucune trace dans l'index");
    } finally {
      db.close();
    }
  });

  test("Content-Signal ai-input=yes : passe", async () => {
    const { fetchImpl } = makeFetch(
      baseRoutes({
        [ROBOTS]: fakeResponse(200, "User-agent: *\nContent-Signal: search=yes, ai-input=yes\n"),
        [LLMS]: fakeResponse(200, LLMS_BODY)
      })
    );
    const db = openStore(":memory:");
    try {
      const result = await createIngester({ fetchImpl, now: () => 0, sleep: async () => {} }).ingest(WIDGETS, db);
      assert.equal(result.indexed, true);
      assert.equal(result.source, "llms.txt");
    } finally {
      db.close();
    }
  });
});

describe("ingestion — cadence et identité", () => {
  test("deux requetes memes origines separees par l'intervalle minimal", async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = makeFetch(baseRoutes({ [LLMS]: fakeResponse(200, LLMS_BODY) }));
    const db = openStore(":memory:");
    try {
      const ingester = createIngester({
        fetchImpl,
        minIntervalMs: 1000,
        now: () => 0, // horloge figee : chaque ecart devient exactement 1000 ms
        sleep: async (ms) => {
          sleeps.push(ms);
        }
      });
      await ingester.ingest(WIDGETS, db);
      assert.ok(sleeps.length >= 2, `cadence non appliquee : ${sleeps.length} pauses`);
      for (const ms of sleeps) assert.equal(ms, 1000);
    } finally {
      db.close();
    }
  });

  test("GITHUB_TOKEN : portee sur raw.githubusercontent uniquement", async () => {
    const { fetchImpl, requests } = makeFetch(
      baseRoutes({ [LLMS]: fakeResponse(200, LLMS_BODY) })
    );
    const db = openStore(":memory:");
    try {
      const ingester = createIngester({ fetchImpl, githubToken: "tok-secret", now: () => 0, sleep: async () => {} });
      await ingester.ingest(WIDGETS, db);
      const githubRequests = requests.filter((request) => request.url.includes("raw.githubusercontent.com"));
      const docsRequests = requests.filter((request) => request.url.startsWith("https://docs.example.test"));
      assert.ok(githubRequests.length >= 1, "la licence passe par raw.githubusercontent");
      for (const request of githubRequests) {
        assert.equal(request.headers.authorization, "Bearer tok-secret");
      }
      assert.ok(docsRequests.length >= 1);
      for (const request of docsRequests) {
        assert.equal(request.headers.authorization, undefined, "le jeton ne fuite jamais vers le site docs");
      }
    } finally {
      db.close();
    }
  });
});

describe("ingestion — unitaires de la couche protocolaire", () => {
  test("parseRobots : le groupe qui nous nomme prime sur *", () => {
    const named = parseRobots(
      "User-agent: novahiz-docs\nDisallow: /nope/\n\nUser-agent: *\nDisallow: /all/\n",
      "novahiz-docs"
    );
    assert.equal(blockedBy(named, "/all/x"), null);
    assert.equal(blockedBy(named, "/nope/x"), "/nope/");
  });

  test("parseRobots : Allow le plus long gagne, ex-aequo : Allow", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /admin/\nAllow: /admin/public\nContent-Signal: ai-input=no\n",
      "novahiz-docs"
    );
    assert.equal(blockedBy(rules, "/admin/x"), "/admin/");
    assert.equal(blockedBy(rules, "/admin/public/page"), null);
    assert.equal(rules.aiInput, false);
  });

  test("parseRobots : fichier vide ou sans groupe applicable = tout permis (RFC 9309)", () => {
    const empty = parseRobots("", "novahiz-docs");
    assert.equal(blockedBy(empty, "/anything"), null);
    assert.equal(empty.aiInput, true);
    const otherAgent = parseRobots("User-agent: SomeBot\nDisallow: /\n", "novahiz-docs");
    assert.equal(blockedBy(otherAgent, "/x"), null, "un groupe d'un autre agent ne s'applique pas");
  });

  test("htmlToText : titres H1-H3 en markdown, balisage lave, entites decodees", () => {
    const text = htmlToText("<h2>Title</h2><p>Hello <b>world</b> &amp; co</p><script>var x=1;</script>");
    assert.ok(text.includes("## Title"));
    assert.ok(text.includes("Hello world & co"));
    assert.ok(!text.includes("<"), "aucun tag residuel");
    assert.ok(!text.includes("var x=1;"), "le script est jete");
  });

  test("isLlmsIndex : H1 exigé, BOM accepte, HTML rejete", () => {
    assert.equal(isLlmsIndex("# Guide"), true);
    assert.equal(isLlmsIndex("\uFEFF# Guide"), true);
    assert.equal(isLlmsIndex("<!DOCTYPE html><html></html>"), false);
    assert.equal(isLlmsIndex(""), false);
    assert.equal(isLlmsIndex("no heading here"), false);
  });
});
