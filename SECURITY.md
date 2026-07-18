# Security policy

## Supported versions

Security fixes are applied on the latest `main` only.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Email or use GitHub’s private vulnerability reporting for this repository:

1. Open https://github.com/jrr97/runescape-ai/security/advisories/new
2. Include steps to reproduce, impact, and any suggested fix

Please allow a reasonable time for a response before any public disclosure.

## Secrets and local config

Never commit `.env`, gateway property files, API tokens, or account credentials. Use the provided `.env.example` / `config.example.properties` files as templates only.
