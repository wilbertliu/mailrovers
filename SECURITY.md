# Security policy

MailRovers handles email, OAuth tokens, and AI provider credentials. Report suspected
security problems privately so maintainers can investigate before details become public.

## Supported versions

MailRovers is alpha software and has no public packaged release.

| Version                 | Security support   |
| ----------------------- | ------------------ |
| Current `main` branch   | Supported          |
| Older commits and forks | Not supported      |
| Packaged releases       | None available yet |

## Report a vulnerability

Do not include vulnerability details in an issue, discussion, pull request, or social
post.

1. Open the repository's **Security** page.
2. Use **Report a vulnerability** if GitHub shows that button.
3. If the button is unavailable, open a
   [private contact request](https://github.com/wilbertliu/mailrovers/issues/new?template=private-contact.yml)
   without technical details.
4. Wait for a maintainer to arrange a private channel before sharing the report.

The repository is currently private and GitHub private vulnerability reporting is not
enabled. This fallback avoids publishing sensitive details in an issue.

Include these details in the private report:

- The affected commit, package, or application version
- The security impact and who could be affected
- Reproduction steps or a minimal proof of concept
- Any credentials, accounts, or data touched during testing
- A suggested fix or mitigation, if you have one

Remove real tokens, email contents, personal data, and credentials from logs and
screenshots.

## What counts as a security issue

Examples include:

- Exposure or recovery of Gmail refresh tokens or AI API keys
- A renderer-to-main-process privilege or IPC validation bypass
- Script execution, navigation, or sandbox escape through email HTML
- Unauthorized mailbox actions or access to another mailbox's data
- Provider responses that bypass validation and cause code execution or credential leaks

Ordinary bugs, feature requests, and provider compatibility problems without a security
impact belong in the issue tracker.

## What to expect

Maintainers review private security reports as capacity allows. Response times may vary.

If a report is accepted, the maintainer will coordinate investigation, remediation, and
disclosure with the reporter. Please keep the report private until a fix is released or a
disclosure date is agreed upon.

MailRovers does not currently offer a bug bounty.

## Safe research

- Use accounts and data you own or have explicit permission to test.
- Stop if testing could access another person's data or disrupt a service.
- Do not use denial-of-service, social-engineering, or destructive techniques.
- Store test credentials securely and revoke them when testing ends.
- Give maintainers reasonable time to investigate and ship a fix before disclosure.
