# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it.

You'll hear back within a few days. The fix ships in a new release, and the advisory credits you unless you'd rather it didn't.

## Supported versions

Security fixes go into the latest release only.

## Scope

show-your-work runs as a Claude Code hook. It reads the session log Claude Code already keeps and makes no network requests. The failures worth reporting are a crafted session log or repository that makes the hook run a command, write a file or leak what the log contains, and anything that makes it block an agent in a loop.
