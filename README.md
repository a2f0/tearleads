# Tearleads

## Getting Started

```bash
pnpm install
pnpm dev
```

### App Store Connect API Key

An App Store connect API key is needed for Fastlane's build automation.

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
1. Navigate to **Users and Access** → **Integrations** tab
1. Click `Generate API Key` to create a new API Key
1. Give it a name (e.g., "GitHub Actions").
1. Set role to **App Manager**.
1. Download the `.p8` file, and put it into `.secrets/`
1. Export `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`.
1. Use [scripts/setGithubVars.sh](scripts/setGithubVars.sh) to deploy it to GitHub.

### GitHub Personal Access Token (Fastlane Match)

A personal access token is required for Fastlane Match, which is used for signing certificate and provisioning profile management. To configure this:

1. Create a new GitHub Repository
1. Go to [Personal Access Tokens](https://github.com/settings/personal-access-tokens)
1. Give the token the following permissions:
   - Read access to metadata
   - Read and Write access to code
1. Encode the token with `echo -n "<github handle>:<personal access token>" | base64 | pbcopy` and set it to `MATCH_GIT_BASIC_AUTHORIZATION`
1. Use [scripts/setGithubVars.sh](scripts/setGithubVars.sh) to set it in GitHub (for GitHub Actions).

### Self-Hosted GitHub Actions Runner

A self-hosted runner allows CI jobs to run on your local Mac instead of GitHub-hosted runners. To set this up:

1. Go to [Personal Access Tokens](https://github.com/settings/tokens)
1. Generate a new token (classic) with the `repo` scope
1. Run the setup script:

   ```bash
   export GITHUB_TOKEN="ghp_your_token_here"
   ./scripts/setupGithubRunner.sh
   ```

1. Verify the runner appears at [Settings → Actions → Runners](https://github.com/a2f0/rapid/settings/actions/runners)

The runner will start automatically after setup and run in the foreground. To restart it later:

```bash
cd ~/actions-runner && ./run.sh
```
