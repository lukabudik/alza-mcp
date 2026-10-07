# Alza MCP Project Rules

These rules apply equally to every developer, agent, and automation process working in this repository.

- Treat all APK- or source-confirmed endpoints and action families as in scope.
- Map and document catalog, account, profile, address, review, complaint, subscription, basket, delivery, checkout, payment, order, attachment, administrative, telemetry, and device-token operations.
- For every operation, record its method, route, inputs, DTO, response, prerequisites, side effects, and verification status.
- Use the labels `source-confirmed`, `live-verified`, `blocked`, and `unresolved` consistently.
- Do not silently omit dynamic, authenticated, mutating, or high-impact operations; document their behavior and requirements instead.
- Prefer typed operation-specific implementations with explicit input validation and confirmation flows for complex actions.
- Keep endpoint documentation and live-test results synchronized with the implementation.
- Before declaring code work complete, run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- When you find a bug, broken endpoint, or failing check that is outside your current task, report it as a GitHub issue instead of dropping it: search first with `gh issue list --repo lukabudik/alza-mcp-community --state all --search "<keywords>"`, then file with `gh issue create --repo lukabudik/alza-mcp-community --label <bug|endpoint-broken|enhancement|documentation>`, including reproduction steps and redacting credentials and personal data.
