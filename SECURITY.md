# Security Policy

No auth in this server by design (public read-only catalogue). Report vulnerabilities via GitHub Issues (or email the maintainer via the GitHub profile). Do not open PRs with secrets. The bundled Supabase anon key is Aura's own public key shipped to every site visitor — rotate via `AURA_SUPABASE_ANON_KEY` if Aura rotates it.
