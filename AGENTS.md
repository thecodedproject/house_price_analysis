# AGENTS.md

Instructions for AI coding agents (and humans) working in this repository.

## ⛔ RULE ZERO: NO PERSONAL DATA IN THE REPOSITORY. EVER.

This tool scrapes house prices for the owner's **own neighbourhood**. The scraped data, and
the config that says which neighbourhood, would reveal **where the owner lives**. This
repository is (or may become) **public**. Anything committed and pushed must be treated as
published permanently: git history, forks, caches and mirrors keep it even after it is
"deleted". **A leak cannot be undone.**

You **MUST NOT** commit, stage, or write into any tracked file **any** of the following:

- **Email addresses**, especially the Zoopla login email. The only email addresses allowed
  are placeholders such as `you@example.com`.
- **Postcodes** other than the allowed Westminster test postcodes listed below. This covers
  every form: upper case with or without the space, lower case, and Zoopla's
  hyphenated slugs.
- **Addresses, street names, house numbers or flat names** from the owner's area.
- **Anything derived from scraped data**: UPRNs, Zoopla listing IDs, Land Registry
  transaction IDs, prices paired with dates for a real property, coordinates, agent names,
  listing descriptions, photos, floor plans, or raw HTML/CSV/JSON responses.
- **Anything from these private, gitignored locations**, copied, pasted, quoted,
  summarised or "anonymised":
  - `data/`: the DB, raw scrapes, images and the browser profile (which holds login cookies)
  - `config/area.json`: the owner's postcodes
  - `config/zoopla.json`: the owner's email

This applies to **every** tracked file: source, tests, test fixtures, snapshots, comments,
docs, README examples, commit messages, PR descriptions, issue text, and error messages
or log lines added to the code. It also applies to anything you send to an external
service: never put the owner's postcodes, addresses or email in a URL, request, search
query or third-party tool unless the owner explicitly asks you to.

**Never weaken these rules.** Do not remove entries from `.gitignore`, do not run
`git add -f` on an ignored file, do not bypass the pre-commit hook (`--no-verify`), and do
not add postcodes to the checker's allowlist (`ALLOWED_POSTCODES`) without the owner's
explicit instruction. If you think a rule is getting in the way, **stop and ask**.

### The only real-world data allowed: Westminster, by the Houses of Parliament

When a test, fixture, example or doc needs a realistic address, use **only** the Houses
of Parliament and properties scraped from the streets right next to it:

| Postcode   | What                                              |
|------------|---------------------------------------------------|
| `SW1A 0AA` | Houses of Parliament (the landmark itself)        |
| `SW1P 3BU` | Great Smith Street (flats; Zoopla fixtures)       |
| `SW1P 3NG` | Barton Street (houses; Land Registry fixture)     |
| `SW1P 3LA` | Lord North Street                                 |

New fixtures **must** be scraped fresh from one of these postcodes into a scratch
directory, trimmed, and checked. **Never** copy anything from `data/raw/` (or anywhere
else in `data/`) into `__fixtures__/`, even "temporarily" or "just to debug". Purely
synthetic data, such as made-up house numbers on Barton Street, is fine too. Do not invent
addresses in other real places, because a made-up address may well be someone's home.

### Before every commit: run the check

```sh
yarn check:private
```

`src/scripts/check_private_data.ts` scans every file that could be committed (tracked +
untracked-but-not-ignored). It fails on:
- any postcode outside the allowlist;
- any non-placeholder email;
- any private path that isn't gitignored;
- any binary file;
- any street, postcode, UPRN or listing/transaction ID found in your local private files.

It also runs as a git pre-commit hook (`.githooks/pre-commit`). `yarn install` enables
it automatically through the `prepare` script. If you haven't run `yarn install`, enable
it by hand:

```sh
git config core.hooksPath .githooks
```

The check is a **safety net, not a guarantee**. It cannot spot everything, such as a
description or a price paired with a date. Before committing, **read the diff yourself**
(`git diff --cached`), and check every new or changed fixture file in full.

**If personal data is ever committed**, stop. **Do not push.** Tell the owner
immediately. If the commit has already been pushed, rewriting history is required, and
that decision belongs to the owner.

## Project notes

- See `README.md` for setup, scraping commands and the data model.
- `yarn test` (jest), `yarn typecheck` (tsc), `yarn check:private`: run all three before
  you consider a change done.
- Scrapers run locally in Node (`src/scripts/`); the SPA (`src/app/`) reads the local
  `data/` folder in the browser. Shared types and DB code are in `src/shared/`.
- Zoopla's terms prohibit scraping: keep any live runs minimal and slow, and never commit
  their output.
