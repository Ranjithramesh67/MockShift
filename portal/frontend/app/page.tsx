import type { ReactNode } from 'react';
import CatalogPreview from '@/components/CatalogPreview';
import AccountLink from '@/components/AccountLink';

// The running API Hub app (login). Swap this when the preview host changes.
const APP_URL = 'https://3000-a7f640d9151cb340.monkeycode-ai.live';

type IconName =
  | 'edit'
  | 'curl'
  | 'send'
  | 'folder'
  | 'workflow'
  | 'code'
  | 'layers'
  | 'history'
  | 'lock'
  | 'users'
  | 'shield'
  | 'check'
  | 'external';

const ICON_PATHS: Record<IconName, string[]> = {
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'],
  curl: [
    'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
    'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z',
  ],
  send: ['m22 2-7 20-4-9-9-4L22 2z', 'M22 2 11 13'],
  folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
  workflow: [
    'M17 2l4 4-4 4',
    'M3 11v-1a4 4 0 0 1 4-4h14',
    'M7 22l-4-4 4-4',
    'M21 13v1a4 4 0 0 1-4 4H3',
  ],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  layers: ['m12 2 10 5-10 5L2 7l10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  history: ['M3 3v5h5', 'M3.05 13A9 9 0 1 0 6 5.3L3 8', 'M12 7v5l4 2'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M4 11h16v11H4z'],
  users: [
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M23 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  shield: ['M12 2 4.5 5.5v6c0 4.6 3 8.4 7.5 10.5 4.5-2.1 7.5-5.9 7.5-10.5v-6L12 2z'],
  check: ['M20 6 9 17l-5-5'],
  external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className="ic"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name].map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">AH</span>;
}

function CheckSvg() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="15"
      height="15"
      aria-hidden="true"
      className="ic"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5 8.2 15 16 6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ content */

type Feature = {
  icon: IconName;
  title: string;
  body: string;
  bullets: string[];
};

const FEATURES: Feature[] = [
  {
    icon: 'edit',
    title: 'Build any request',
    body: 'A Postman-style editor for REST, SOAP, GraphQL and auth requests. Query params, headers, auth providers and rich bodies live in one focused panel.',
    bullets: [
      'All methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'Bodies: JSON, XML, form-urlencoded, raw text, GraphQL and multipart with file uploads',
      'Folder-level auth providers and environment variable substitution',
      'Syntax-highlighted JSON / XML / JS editors with formatting',
    ],
  },
  {
    icon: 'curl',
    title: 'Paste cURL, get structure',
    body: 'Stop rebuilding requests by hand. Drop a cURL command anywhere and API Hub parses the method, URL, query params, headers and body for you.',
    bullets: [
      'Auto-detected in the create request modal and straight into the URL field',
      'Scratchpad to test a cURL without saving anything to your collection',
      'Save the parsed request into any collection or nested folder when ready',
    ],
  },
  {
    icon: 'send',
    title: 'Send before you save',
    body: 'Every edit updates the working copy the instant you type — Send runs exactly what you see, and the stored request only changes when you hit Save.',
    bullets: [
      'Ephemeral run engine — no stored request required to fire a call',
      'Dirty-state dot flags unsaved edits on tabs and the Save button',
      'Per-request undo/redo and back-to-previous for every open request',
    ],
  },
  {
    icon: 'folder',
    title: 'Organise collections & folders',
    body: 'Nested folder trees keep your API catalog tidy as it grows. Move, duplicate and rename rows without leaving the keyboard.',
    bullets: [
      'Nested folders with drag-and-drop moves for requests and folders',
      'Duplicate requests or whole folders instantly (Ctrl/Cmd + C)',
      'Import and export collections in a portable JSON format',
      'Inline rename with F2 and shortcuts for everything else',
    ],
  },
  {
    icon: 'workflow',
    title: 'Automate with workflows',
    body: 'Turn individual requests into reliable pipelines. Extract values, transform payloads, assert results and trigger runs on your schedule.',
    bullets: [
      'Sandboxed formula engine evaluates expressions server-side',
      'Assertions and tests per request with clear pass/fail feedback',
      'Schedule automations on cron or fire them instantly via webhook',
      'Multi-step workflows feed one request’s output into the next',
    ],
  },
  {
    icon: 'code',
    title: 'Mock servers & generated code',
    body: 'Let frontend and partner teams build against endpoints that do not exist yet — then hand them ready-to-run client code in minutes.',
    bullets: [
      'Per-project mock server with realistic routing and response data',
      'Mock data store preloaded and editable at runtime',
      'Generate request code for Node, Axios, Python, Go, PHP, Laravel and more',
    ],
  },
];

type Step = { title: string; body: string };

const STEPS: Step[] = [
  {
    title: 'Create',
    body: 'Paste a cURL or type a method and URL. Params, headers and body are structured into editable fields instantly.',
  },
  {
    title: 'Send & inspect',
    body: 'Run the request with environment variables and encrypted secrets injected. Inspect a clean, readable response.',
  },
  {
    title: 'Assert & automate',
    body: 'Add formulas and assertions, then chain requests into scheduled or webhook-driven workflows.',
  },
  {
    title: 'Share & ship',
    body: 'Generate client code, share collection links, stand up a mock server and watch history across the team.',
  },
];

const TEAM_POINTS: Array<{ key: string; node: ReactNode }> = [
  {
    key: 'hierarchy',
    node: (
      <>Organise work across <strong>organisations → teams → workspaces → projects</strong>, each with its own collections and requests.</>
    ),
  },
  {
    key: 'membership',
    node: (
      <>Self-service <strong>membership management</strong> on every project — add members and change roles as the project manager.</>
    ),
  },
  {
    key: 'sharing',
    node: (
      <>Share workspaces and collections, and <strong>invite collaborators</strong> by role so everyone works from the same source of truth.</>
    ),
  },
  {
    key: 'overview',
    node: (
      <>A <strong>project overview</strong> that shows collections, requests, automations and recent runs at a glance.</>
    ),
  },
  {
    key: 'history',
    node: (
      <>Full <strong>run history</strong> and notifications keep the whole team aware of what happened and when.</>
    ),
  },
];

const SECURITY_POINTS: Array<{ key: string; node: ReactNode }> = [
  {
    key: 'rbac',
    node: (
      <>Every route checks access — roles <strong>VIEWER · EDITOR · MANAGER · ADMIN</strong> (plus <strong>SUPPORT</strong> in the portal) gate every operation.</>
    ),
  },
  {
    key: 'vault',
    node: (
      <>Secret environment values are stored <strong>encrypted in a server-side vault</strong> and only decrypted for a run.</>
    ),
  },
  {
    key: 'sandbox',
    node: (
      <>Formula execution runs in an <strong>isolated sandbox</strong> (isolated-vm), never on the host process.</>
    ),
  },
  {
    key: 'redaction',
    node: (
      <>Per-request <strong>response redaction</strong>, row-level DB security and a complete <strong>audit log</strong>.</>
    ),
  },
  {
    key: 'retention',
    node: (
      <>Configurable <strong>retention policies</strong> keep history and data under your control.</>
    ),
  },
];

const FAQS = [
  {
    q: 'What exactly is API Hub?',
    a: 'API Hub is a collaborative, Postman-style platform for designing, testing and automating API requests. You build requests in a browser workspace, run them against live or mock endpoints, assert the results, and chain them into workflows — with teams, workspaces, projects and role-based access on top.',
  },
  {
    q: 'Do I need a credit card to try a paid plan?',
    a: 'No card is required to sign up — the Free plan is free to use forever. Paid plans do not come with a separate trial: instead, your first recharge of Starter, Pro or Team adds 5, 10 or 15 extra days of validity on top of the paid period. If a paid plan is not for you, you can always drop back to the Free plan without losing your data.',
  },
  {
    q: 'Can I really paste a cURL and start without saving?',
    a: 'Yes. Paste a cURL into the create modal or the URL field of any request and it is parsed into method, URL, params, headers and body automatically. The scratchpad lets you fire that request immediately, with nothing saved until you choose to.',
  },
  {
    q: 'How are formulas and workflows kept safe?',
    a: 'Formula expressions run in an isolated sandbox server-side, with limits that stop runaway work. Workflows chain request outputs through that engine, and every run is recorded in history with retention policies you control.',
  },
  {
    q: 'What are the plan limits?',
    a: 'Plans scale the number of workspaces, projects and seats plus storage. Free is one workspace and project; paid tiers add more (and unlimited on Team/Enterprise). See the pricing grid above for the current limits.',
  },
  {
    q: 'Can I switch, cancel or get enterprise terms?',
    a: 'Yes. Upgrade, downgrade or cancel anytime — changes apply at the end of the current billing period, and yearly billing saves roughly 17%. The Enterprise plan adds unlimited seats, SAML SSO, an SLA and a dedicated customer success manager; contact sales for custom pricing.',
  },
  {
    q: 'How is my data secured?',
    a: 'Secret values are encrypted in a server-side vault, database access is enforced row-by-row, request responses can be redacted, and sensitive operations are written to an audit log. Formula runs are sandboxed and data retention is configurable per workspace.',
  },
];

/* ------------------------------------------------------------------ page */

export default function Home() {
  return (
    <div className="site">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="#top">
            <BrandMark />
            <span>API Hub</span>
          </a>
          <nav className="nav-links" aria-label="Page">
            <a href="#product">Product</a>
            <a href="#workflow">How it works</a>
            <a href="#collaborate">Teams</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-actions">
            <AccountLink className="btn btn-outline btn-sm" />
            <a className="btn btn-outline btn-sm" href={APP_URL} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> Open app
            </a>
            <a className="btn btn-primary btn-sm" href="#pricing">
              Get started
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ------------------------------------------------ Hero */}
        <section className="hero">
          <p className="eyebrow">API testing &amp; workflow platform</p>
          <h1>
            Test your APIs, <em>on autopilot.</em>
          </h1>
          <p className="hero-lede">
            <strong>API Hub</strong> is a collaborative workspace for designing, testing and
            automating API requests. Paste a cURL, build requests in your browser, chain them
            into workflows with sandboxed formulas, stand up mock servers — all across teams
            with fine-grained access control.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#pricing">
              See plans &amp; pricing
            </a>
            <a className="btn btn-outline btn-lg" href="#product">
              Meet the product
            </a>
            <a className="btn btn-ghost btn-lg" href={APP_URL} target="_blank" rel="noreferrer">
              Open app <Icon name="external" size={16} />
            </a>
          </div>
          <ul className="chip-row">
            <li>REST · SOAP · GraphQL</li>
            <li>
              Paste-cURL <em>auto-parse</em>
            </li>
            <li>
              Scratchpad <em>testing</em>
            </li>
            <li>Multipart &amp; file uploads</li>
            <li>Mock servers</li>
            <li>
              Sandboxed <em>formulas</em>
            </li>
            <li>Workflow automation</li>
            <li>Teams &amp; RBAC</li>
            <li>Audit &amp; retention</li>
          </ul>
        </section>

        {/* ------------------------------------------------ Product */}
        <section id="product" className="section product-section">
          <div className="section-head">
            <span className="kicker">The workspace</span>
            <h2>One place to design, test and automate every request</h2>
            <p className="section-lede">
              Everything a team needs to ship working APIs — a full request editor, instant
              cURL parsing, safe execution, organised collections and automation that runs on
              your behalf.
            </p>
          </div>
          <div className="product-grid">
            {FEATURES.map((f) => (
              <article className="feature-card" key={f.title}>
                <span className="feature-ic">
                  <Icon name={f.icon} size={22} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <ul className="feature-bullets">
                  {f.bullets.map((b) => (
                    <li key={b}>
                      <span className="dot" aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ How it works */}
        <section id="workflow" className="section workflow-section">
          <div className="section-head">
            <span className="kicker">Workflow</span>
            <h2>From idea to integration in four steps</h2>
            <p className="section-lede">
              The same flow powers a quick sanity check and a production-grade automation
              pipeline — no setup ceremony in between.
            </p>
          </div>
          <div className="steps-grid">
            {STEPS.map((s, i) => (
              <div className="step" key={s.title}>
                <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>

          <div className="split">
            <div className="split-col">
              <h3>
                <span className="ic-wrap">
                  <Icon name="layers" size={18} />
                </span>
                Environments &amp; history
              </h3>
              <p>
                Reuse the same requests across staging, test and production without editing
                every URL by hand.
              </p>
              <ul className="tick-list">
                <li>
                  <CheckSvg /> Workspace <strong>environment variables</strong> substitute into URLs, headers and bodies
                </li>
                <li>
                  <CheckSvg /> <strong>Encrypted secret</strong> values never leave the vault in plain text
                </li>
                <li>
                  <CheckSvg /> Every send is recorded in <strong>run history</strong> — for a request or the whole project
                </li>
                <li>
                  <CheckSvg /> <strong>Response viewer</strong> shows status, headers and pretty-printed bodies
                </li>
              </ul>
            </div>
            <div className="split-col">
              <h3>
                <span className="ic-wrap">
                  <Icon name="shield" size={18} />
                </span>
                Safe by default
              </h3>
              <p>
                Testing means touching real systems — API Hub makes sure only intended data
                moves, and everything is sandboxed.
              </p>
              <ul className="tick-list">
                <li>
                  <CheckSvg /> <strong>Sandboxed execution</strong> for formulas and workflows — isolated-vm, never the host
                </li>
                <li>
                  <CheckSvg /> Secret variables are <strong>encrypted at rest</strong> in a server-side vault
                </li>
                <li>
                  <CheckSvg /> Sensitive responses can be <strong>redacted</strong> before they reach the screen
                </li>
                <li>
                  <CheckSvg /> <strong>Retention policies</strong> prune history and data on your schedule
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Collaborate */}
        <section id="collaborate" className="section collab-section">
          <div className="section-head">
            <span className="kicker">Teams &amp; workspaces</span>
            <h2>Built for teams that ship together</h2>
            <p className="section-lede">
              From a solo side-project to an organisation with many teams, API Hub keeps the
              right requests in front of the right people.
            </p>
          </div>
          <div className="band">
            <ul className="tick-list">
              {TEAM_POINTS.map((p) => (
                <li key={p.key}>
                  <CheckSvg /> {p.node}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------ Security */}
        <section id="security" className="section security-section">
          <div className="section-head">
            <span className="kicker">Security &amp; access</span>
            <h2>Enterprise-ready controls on every tier</h2>
            <p className="section-lede">
              Access is enforced at the API and the database, secrets are protected, and
              everything sensitive is recorded for review.
            </p>
          </div>
          <div className="band">
            <ul className="tick-list">
              {SECURITY_POINTS.map((p) => (
                <li key={p.key}>
                  <CheckSvg /> {p.node}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------ Pricing */}
        <section id="pricing" className="section pricing-section">
          <div className="section-head">
            <span className="kicker">Pricing</span>
            <h2>Plans for every stage</h2>
            <p className="section-lede">
              From a single workspace to organisation-wide control — workspaces, projects,
              seats and storage grow with your team. Your first recharge of Starter, Pro or
              Team adds 5, 10 or 15 extra days of validity.
            </p>
          </div>
          <CatalogPreview />
        </section>

        {/* ------------------------------------------------ FAQ */}
        <section id="faq" className="section faq-section">
          <div className="section-head">
            <span className="kicker">FAQ</span>
            <h2>Frequently asked questions</h2>
          </div>
          <div className="faq-list">
            {FAQS.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>
                  <span>{f.q}</span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ Final CTA */}
        <section className="final-cta">
          <h2>Ready to test your APIs on autopilot?</h2>
          <p>
            Start free today — paste your first cURL in under a minute. When your team grows,
            pick a paid plan and earn extra validity days on your first recharge.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#pricing">
              See plans &amp; pricing
            </a>
            <a className="btn btn-outline btn-lg" href={APP_URL} target="_blank" rel="noreferrer">
              Open API Hub <Icon name="external" size={16} />
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <a className="brand brand-sm" href="#top">
            <BrandMark />
            <span>API Hub</span>
          </a>
          <nav className="footer-links" aria-label="Footer">
            <a href="#product">Product</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href={APP_URL} target="_blank" rel="noreferrer">
              Sign in
            </a>
          </nav>
          <p className="footer-note">
            <strong>API Hub</strong> — public showcase (Portal A) · subscription management
            (Portal B) is internal
          </p>
        </div>
      </footer>
    </div>
  );
}
