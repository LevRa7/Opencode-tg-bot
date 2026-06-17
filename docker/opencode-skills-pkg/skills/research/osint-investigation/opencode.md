# OSINT Investigation — Public Records Cross-Reference

Public-records OSINT: government contracts, corporate filings, lobbying, sanctions, offshore leaks, property records, court records, web archives, knowledge bases, and global news. Resolve entities across sources, build cross-links, run timing tests, produce evidence chains.

**Python stdlib only.** Most sources work with no API key.

## When to Use

- "Follow the money" — contracts, lobbying, sanctions
- Corporate due diligence — who controls company X
- Sanctions screening — is entity X on OFAC SDN
- Property ownership — NYC ACRIS deeds/mortgages
- Litigation history — federal + state court opinions
- Multi-source entity resolution with varying names
- Evidence-chain construction with confidence levels

Do NOT use for: general web research (use `websearch`/`webfetch`), social-media profile discovery (use `sherlock`), or US federal campaign finance (use FEC.gov directly).

## Workflow

### 1. Acquire Data

Each source has a stdlib fetch script. Run via Bash:

```bash
# SEC EDGAR
python3 fetch_sec_edgar.py --cik 0000320193 --types 10-K,10-Q --out data/edgar_filings.csv

# USAspending
python3 fetch_usaspending.py --recipient "EXAMPLE CORP" --fy 2024 --out data/contracts.csv

# Senate lobbying
python3 fetch_senate_ld.py --client "EXAMPLE CORP" --year 2024 --out data/lobbying.csv

# OFAC SDN sanctions
python3 fetch_ofac_sdn.py --out data/ofac_sdn.csv

# ICIJ Offshore Leaks
python3 fetch_icij_offshore.py --entity "EXAMPLE CORP" --out data/icij.csv

# NYC property records (ACRIS)
python3 fetch_nyc_acris.py --name "SMITH, JOHN" --out data/acris.csv

# OpenCorporates (requires OPENCORPORATES_API_TOKEN)
python3 fetch_opencorporates.py --query "Example Corp" --jurisdiction us_ny --out data/opencorporates.csv

# CourtListener
python3 fetch_courtlistener.py --query "Smith v. Example Corp" --type opinions --out data/courts.csv

# Wayback Machine
python3 fetch_wayback.py --url "example.com" --match host --out data/wayback.csv

# Wikipedia + Wikidata
python3 fetch_wikipedia.py --query "Bill Gates" --out data/wp.csv

# GDELT global news
python3 fetch_gdelt.py --query '"Example Corp"' --timespan 1y --out data/gdelt.csv
```

### 2. Resolve Entities Across Sources

```bash
python3 entity_resolution.py --left data/lobbying.csv --left-name-col client_name \
  --right data/contracts.csv --right-name-col recipient_name --out data/cross_links.csv
```

Three matching tiers: `exact` (high), `fuzzy` (medium), `token_overlap` (low).

### 3. Timing Correlation (optional)

```bash
python3 timing_analysis.py --donations data/lobbying.csv --donation-date-col filing_date \
  --contracts data/contracts.csv --contract-date-col award_date \
  --cross-links data/cross_links.csv --permutations 1000 --out data/timing.json
```

### 4. Build Findings JSON

```bash
python3 build_findings.py --cross-links data/cross_links.csv \
  --timing data/timing.json --out data/findings.json
```

## Confidence Rules

- Every claim must trace to a record. No naked assertions.
- Confidence tier travels with the claim.
- Entity resolution produces candidates, NOT conclusions.
- Statistical significance ≠ wrongdoing.
