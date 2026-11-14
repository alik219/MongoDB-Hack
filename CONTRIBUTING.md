# Contributing

This guide covers how to get access to the repo, set up your machine, and ship code without stepping on each other during the hackathon.

---

## 1. Get access

### For teammates
1. Send the repo owner your **GitHub username** (on Discord).
2. The owner adds you: **Settings → Collaborators → Add people**.
3. Accept the invite from your email or from https://github.com/notifications.
4. You can now push branches directly to this repo. No fork needed.

### For the repo owner (adding people)
- Go to **Settings → Collaborators → Add people**, then enter their GitHub username.
- Optional, but useful once code starts landing: **Settings → Branches → Add rule** for `main`, and turn on **Require a pull request before merging**.

### For outside contributors (not on the team)
Fork the repo, push to your fork, and open a pull request against `main`.

---

## 2. One-time machine setup

### Install Git and tell it who you are
```bash
git --version   # check that it's installed
git config --global user.name "Your Name"
git config --global user.email "you@example.com"   # the email on your GitHub account
```
> Tip: to keep your email private, use your GitHub **noreply** address from https://github.com/settings/emails.

### Authenticate with GitHub (pick one)

**Option A: GitHub CLI (easiest)**
```bash
# macOS:   brew install gh
# Windows: winget install --id GitHub.cli
gh auth login     # choose GitHub.com → HTTPS → login with a web browser
```

**Option B: SSH key**
```bash
ssh-keygen -t ed25519 -C "you@example.com"
cat ~/.ssh/id_ed25519.pub   # copy this output
```
Paste the key at https://github.com/settings/ssh/new, then run `ssh -T git@github.com` to check it works.

### Clone the repo
```bash
git clone https://github.com/<owner>/<repo>.git     # HTTPS (Option A)
# or
git clone git@github.com:<owner>/<repo>.git         # SSH (Option B)
cd <repo>
```

### Environment variables
```bash
cp .env.example .env
```
Fill in `.env` with your own MongoDB Atlas connection string and API keys.
**Never commit `.env`.** It's already in `.gitignore`. Share secrets over Discord DMs, not in the repo.

---

## 3. Day-to-day workflow

We keep `main` always runnable, so it can be demoed at any time.

```bash
# 1. Start from the latest main
git checkout main
git pull

# 2. Make a branch for your task
git checkout -b feat/short-description

# 3. Work, then commit in small chunks
git add .
git commit -m "Add vector search for agent memory"

# 4. Push your branch
git push -u origin feat/short-description
```

Then open a **Pull Request** on GitHub (a "Compare & pull request" button appears after you push). Ask a teammate in Discord to review it, then merge.

### Branch names
| Prefix | Use for |
|---|---|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | README / docs |
| `chore/` | Config, deps, cleanup |

### Keeping your branch up to date
```bash
git checkout main && git pull
git checkout your-branch
git merge main          # fix any conflicts, then commit
```

---

## 4. Hackathon ground rules

- **Pull often.** Run `git pull` every time you sit back down.
- **Small PRs merge fast.** Big ones cause conflicts at 2 AM.
- **Talk before touching shared files** (DB schema, agent core loop, `package.json` / `requirements.txt`).
- **No secrets in commits.** If you leak a key, rotate it right away and tell the team.
- **Freeze `main` about an hour before judging.** After that, only demo-critical fixes go in.

## 5. Stuck?
Post in our team's Discord channel. Most git problems take two minutes to fix with a second pair of eyes.
