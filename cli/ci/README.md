# Running apihub checks in CI

`apihub ci run <requestId>` is designed for pipelines: it streams a short
summary to stdout and exits `0` on PASS, `1` on FAIL, `2` on configuration
errors. It is a pure alias of `apihub run` with CI-friendly output and exit
codes, so no extra setup is needed beyond installing the CLI and logging in.

Always pass the API token through the platform's masked secret store; never
paste it into YAML. Token needs: scope `runs` (or `write`) and access to the
workspace that owns the request.

## GitHub Actions

```yaml
name: api-hub-tests
on:
  push:
  schedule:
    - cron: '0 6 * * *'   # nightly smoke against live endpoints

jobs:
  apihub:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install CLI
        run: npm install -g /path/to/repo   # or `npm ci` in the cli folder then npm link

      - name: Login to API Hub
        run: apihub login --base-url "${{ secrets.APIHUB_BASE_URL }}" --token "${{ secrets.APIHUB_TOKEN }}"

      - name: Run checks
        id: apihub-run
        run: apihub ci run "${{ vars.REQUEST_ID }}"
        # Non-zero exit from `ci run` fails the job automatically.

      - name: Archive report on failure
        if: failure()
        run: |
          apihub run "${{ vars.REQUEST_ID }}" --json > latest-run.json
          apihub report markdown --from latest-run.json -o report.md

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: apihub-report
          path: report.md
```

## GitLab CI

```yaml
apihub-smoke:
  stage: test
  image: node:22
  variables:
    REQUEST_ID: "your-request-id-here"
  script:
    - npm install -g /path/to/repo
    - apihub login --base-url "${APIHUB_BASE_URL}" --token "${APIHUB_TOKEN}"
    - apihub ci run "${REQUEST_ID}"
    - apihub run "${REQUEST_ID}" --json > latest-run.json
    - apihub report junit --from latest-run.json -o junit.xml
  artifacts:
    when: always
    reports:
      junit: junit.xml     # surfaces results on the pipeline / MR page
    paths:
      - junit.xml
    expire_in: 30 days
```

`APIHUB_BASE_URL` and `APIHUB_TOKEN` are CI/CD variables; mark the token as
**masked** and **protected**.

## Tips

- Test against a staging workspace, or use request URLs that hit sandbox
  endpoints, so scheduled runs cannot mutate production data.
- Store the request ID as a project-level CI/CD variable so it can be
  rotated without touching the pipeline definition.
- Keep the CLI in a private package registry (or your own repository) and
  pin a version; the CLI has zero runtime dependencies, so installs are
  small and fast.
