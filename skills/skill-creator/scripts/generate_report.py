#!/usr/bin/env python3
"""Generate an HTML report from run_loop.py output.

Takes the JSON output from run_loop.py and generates a visual HTML report
showing each description attempt with check/x for each test case.
Distinguishes between train and test queries.
"""

import argparse
import html
import json
import sys
from pathlib import Path


def generate_html(data: dict, auto_refresh: bool = False, skill_name: str = "") -> str:
    """Generate HTML report from loop output data. If auto_refresh is True, adds a meta refresh tag."""
    history = data.get("history", [])
    holdout = data.get("holdout", 0)
    title_prefix = html.escape(skill_name + " \u2014 ") if skill_name else ""

    # Get all unique queries from train and test sets, with should_trigger info
    train_queries: list[dict] = []
    test_queries: list[dict] = []
    if history:
        for r in history[0].get("train_results", history[0].get("results", [])):
            train_queries.append({"query": r["query"], "should_trigger": r.get("should_trigger", True)})
        if history[0].get("test_results"):
            for r in history[0].get("test_results", []):
                test_queries.append({"query": r["query"], "should_trigger": r.get("should_trigger", True)})

    refresh_tag = '    <meta http-equiv="refresh" content="5">\n' if auto_refresh else ""

    html_parts = ["""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
""" + refresh_tag + """    <title>""" + title_prefix + """Skill Description Optimization</title>
    <style>
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #f5f0eb;
            color: #141413;
        }
        h1 { font-weight: 600; color: #141413; }
        .explainer {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e7e5e0;
            color: #6b7280;
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e7e5e0;
        }
        .summary p { margin: 5px 0; }
        .best { color: #0f766e; font-weight: bold; }
        .table-container {
            overflow-x: auto;
            width: 100%;
        }
        table {
            border-collapse: collapse;
            background: white;
            border: 1px solid #e7e5e0;
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #e7e5e0;
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-weight: 600;
            background: #141413;
            color: #f5f0eb;
        }
        th.test-col {
            background: #0f766e;
        }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result {
            text-align: center;
            font-size: 16px;
            min-width: 40px;
        }
        td.test-result {
            background: #f0faf8;
        }
        .pass { color: #0f766e; }
        .fail { color: #c44; }
        .rate {
            font-size: 9px;
            color: #6b7280;
            display: block;
        }
        tr:hover { background: #f5f0eb; }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: #d9f2ee; color: #0f766e; }
        .score-ok { background: #fef3c7; color: #b45309; }
        .score-bad { background: #fceaea; color: #c44; }
        .train-label { color: #6b7280; font-size: 10px; }
        .test-label { color: #0f766e; font-size: 10px; font-weight: bold; }
        .best-row { background: #eef7f5; }
        th.positive-col { border-bottom: 3px solid #0f766e; }
        th.negative-col { border-bottom: 3px solid #c44; }
        th.test-col.positive-col { border-bottom: 3px solid #0f766e; }
        th.test-col.negative-col { border-bottom: 3px solid #c44; }
        .legend { font-weight: 600; display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #0f766e; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test { background: #0f766e; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
    <h1>""" + title_prefix + """Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> This page updates as the optimizer tests versions of your skill description. Each row is an iteration: a new description attempt. The columns show test queries: green checkmarks mean the skill triggered correctly (or correctly didn't trigger), red crosses mean it got it wrong. The "Train" score shows performance on queries used to improve the description; the "Test" score shows performance on held-out queries the optimizer hasn't seen. When it's done, the best-performing description is applied to your skill.
    </div>
"""]

    # Summary section
    best_test_score = data.get('best_test_score')
    best_train_score = data.get('best_train_score')
    html_parts.append(f"""
    <div class="summary">
        <p><strong>Original:</strong> {html.escape(data.get('original_description', 'N/A'))}</p>
        <p class="best"><strong>Best:</strong> {html.escape(data.get('best_description', 'N/A'))}</p>
        <p><strong>Best Score:</strong> {data.get('best_score', 'N/A')} {'(test)' if best_test_score else '(train)'}</p>
        <p><strong>Iterations:</strong> {data.get('iterations_run', 0)} | <strong>Train:</strong> {data.get('train_size', '?')} | <strong>Test:</strong> {data.get('test_size', '?')}</p>
    </div>
""")

    # Legend
    html_parts.append("""
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
""")

    # Table header
    html_parts.append("""
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
""")

    # Add column headers for train queries
    for qinfo in train_queries:
        polarity = "positive-col" if qinfo["should_trigger"] else "negative-col"
        html_parts.append(f'                <th class="{polarity}">{html.escape(qinfo["query"])}</th>\n')

    # Add column headers for test queries (different color)
    for qinfo in test_queries:
        polarity = "positive-col" if qinfo["should_trigger"] else "negative-col"
        html_parts.append(f'                <th class="test-col {polarity}">{html.escape(qinfo["query"])}</th>\n')

    html_parts.append("""            </tr>
        </thead>
        <tbody>
""")

    # Find best iteration for highlighting
    if test_queries:
        best_iter = max(history, key=lambda h: h.get("test_passed") or 0).get("iteration")
    else:
        best_iter = max(history, key=lambda h: h.get("train_passed", h.get("passed", 0))).get("iteration")

    # Add rows for each iteration
    for h in history:
        iteration = h.get("iteration", "?")
        train_passed = h.get("train_passed", h.get("passed", 0))
        train_total = h.get("train_total", h.get("total", 0))
        test_passed = h.get("test_passed")
        test_total = h.get("test_total")
        description = h.get("description", "")
        train_results = h.get("train_results", h.get("results", []))
        test_results = h.get("test_results", [])

        # Create lookups for results by query
        train_by_query = {r["query"]: r for r in train_results}
        test_by_query = {r["query"]: r for r in test_results} if test_results else {}

        # Compute aggregate correct/total runs across all retries
        def aggregate_runs(results: list[dict]) -> tuple[int, int]:
            correct = 0
            total = 0
            for r in results:
                runs = r.get("runs", 0)
                triggers = r.get("triggers", 0)
                total += runs
                if r.get("should_trigger", True):
                    correct += triggers
                else:
                    correct += runs - triggers
            return correct, total

        train_correct, train_runs = aggregate_runs(train_results)
        test_correct, test_runs = aggregate_runs(test_results)

        # Determine score classes
        def score_class(correct: int, total: int) -> str:
            if total > 0:
                ratio = correct / total
                if ratio >= 0.8:
                    return "score-good"
                elif ratio >= 0.5:
                    return "score-ok"
            return "score-bad"

        train_class = score_class(train_correct, train_runs)
        test_class = score_class(test_correct, test_runs)

        row_class = "best-row" if iteration == best_iter else ""

        html_parts.append(f"""            <tr class="{row_class}">
                <td>{iteration}</td>
                <td><span class="score {train_class}">{train_correct}/{train_runs}</span></td>
                <td><span class="score {test_class}">{test_correct}/{test_runs}</span></td>
                <td class="description">{html.escape(description)}</td>
""")

        # Add result for each train query
        for qinfo in train_queries:
            r = train_by_query.get(qinfo["query"], {})
            did_pass = r.get("pass", False)
            triggers = r.get("triggers", 0)
            runs = r.get("runs", 0)

            icon = "✓" if did_pass else "✗"
            css_class = "pass" if did_pass else "fail"

            html_parts.append(f'                <td class="result {css_class}">{icon}<span class="rate">{triggers}/{runs}</span></td>\n')

        # Add result for each test query (with different background)
        for qinfo in test_queries:
            r = test_by_query.get(qinfo["query"], {})
            did_pass = r.get("pass", False)
            triggers = r.get("triggers", 0)
            runs = r.get("runs", 0)

            icon = "✓" if did_pass else "✗"
            css_class = "pass" if did_pass else "fail"

            html_parts.append(f'                <td class="result test-result {css_class}">{icon}<span class="rate">{triggers}/{runs}</span></td>\n')

        html_parts.append("            </tr>\n")

    html_parts.append("""        </tbody>
    </table>
    </div>
""")

    html_parts.append("""
</body>
</html>
""")

    return "".join(html_parts)


def main():
    parser = argparse.ArgumentParser(description="Generate HTML report from run_loop output")
    parser.add_argument("input", help="Path to JSON output from run_loop.py (or - for stdin)")
    parser.add_argument("-o", "--output", default=None, help="Output HTML file (default: stdout)")
    parser.add_argument("--skill-name", default="", help="Skill name to include in the report title")
    args = parser.parse_args()

    if args.input == "-":
        data = json.load(sys.stdin)
    else:
        data = json.loads(Path(args.input).read_text())

    html_output = generate_html(data, skill_name=args.skill_name)

    if args.output:
        Path(args.output).write_text(html_output)
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        print(html_output)


if __name__ == "__main__":
    main()
